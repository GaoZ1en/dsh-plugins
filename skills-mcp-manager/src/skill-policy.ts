/** DSH-only skill invocation policy. Never reads or changes a skill source file. */
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, isAbsolute, join, resolve } from 'node:path'

export interface SkillPolicyRule { name: string; cwd?: string; enabled: boolean }
export interface SkillPolicySnapshot { revision: number; rules: SkillPolicyRule[] }
interface Document extends SkillPolicySnapshot { schemaVersion: 1 }
interface Observation { document: Document; hash: string | null }
const queues = new Map<string, Promise<unknown>>()
const MAX_BYTES = 1024 * 1024
const MAX_RULES = 4096
const digest = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex')
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }) }
const missing = (error: unknown) => (error as NodeJS.ErrnoException).code === 'ENOENT'
function validName(name: unknown): asserts name is string {
  if (typeof name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name)) fail('INVALID_INPUT', 'A valid skill name is required')
}
function workspace(cwd?: string): string | undefined {
  if (cwd === undefined) return undefined
  if (typeof cwd !== 'string' || cwd.length > 8192 || cwd.includes('\0') || !isAbsolute(cwd)) fail('INVALID_INPUT', 'Workspace must be an absolute path')
  return resolve(cwd)
}
async function noLinks(path: string): Promise<void> {
  for (let current = resolve(path);; current = dirname(current)) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) fail('UNSAFE_STATE', 'Skill policy paths must not contain symlinks') }
    catch (error) { if (!missing(error)) throw error }
    if (dirname(current) === current) break
  }
}
const copy = (value: SkillPolicySnapshot): SkillPolicySnapshot => ({ revision: value.revision, rules: value.rules.map(rule => ({ ...rule })) })

export class SkillPolicyStore {
  private readonly stateDir: string
  private current: Document | undefined
  private diskHash: string | null = null
  private readonly listeners = new Set<() => void>()
  constructor(options: { stateDir: string }) { this.stateDir = resolve(options.stateDir) }
  private path() { return join(this.stateDir, 'skill-policy.json') }
  private ordered<T>(operation: () => Promise<T>): Promise<T> {
    const task = (queues.get(this.stateDir) ?? Promise.resolve()).catch(() => undefined).then(operation)
    const tail = task.catch(() => undefined)
    queues.set(this.stateDir, tail)
    void tail.finally(() => { if (queues.get(this.stateDir) === tail) queues.delete(this.stateDir) })
    return task
  }
  private ready(): Document {
    if (!this.current) fail('CORRUPT_STATE', 'Skill policy is not loaded; refusing to assume skills are enabled')
    return this.current
  }
  private async observe(): Promise<Observation> {
    await noLinks(this.path())
    let handle: fs.FileHandle
    try { handle = await fs.open(this.path(), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK) }
    catch (error) { if (missing(error)) return { document: { schemaVersion: 1, revision: 0, rules: [] }, hash: null }; throw error }
    let bytes: Buffer
    try {
      const stat = await handle.stat()
      if (!stat.isFile() || stat.size > MAX_BYTES) fail('CORRUPT_STATE', 'Skill policy is not a safe regular JSON file')
      bytes = await handle.readFile()
      if (bytes.length > MAX_BYTES) fail('CORRUPT_STATE', 'Skill policy exceeds the size limit')
    } finally { await handle.close() }
    let value: unknown
    try { value = JSON.parse(bytes.toString('utf8')) } catch { fail('CORRUPT_STATE', 'Skill policy JSON is corrupt; refusing to overwrite it') }
    const d = value as Document
    if (!d || typeof d !== 'object' || Array.isArray(d) || Object.keys(d).some(key => !['schemaVersion', 'revision', 'rules'].includes(key)) || d.schemaVersion !== 1 || !Number.isSafeInteger(d.revision) || d.revision < 0 || !Array.isArray(d.rules) || d.rules.length > MAX_RULES) fail('CORRUPT_STATE', 'Skill policy schema is invalid; refusing to overwrite it')
    const seen = new Set<string>()
    for (const rule of d.rules) {
      if (!rule || typeof rule !== 'object' || Array.isArray(rule) || Object.keys(rule).some(key => !['name', 'cwd', 'enabled'].includes(key)) || typeof rule.enabled !== 'boolean') fail('CORRUPT_STATE', 'Skill policy contains an invalid rule')
      try { validName(rule.name); if (rule.cwd !== undefined && workspace(rule.cwd) !== rule.cwd) throw new Error('noncanonical path') }
      catch { fail('CORRUPT_STATE', 'Skill policy contains an invalid name or workspace') }
      const key = JSON.stringify([rule.name, rule.cwd ?? null])
      if (seen.has(key)) fail('CORRUPT_STATE', 'Skill policy contains duplicate rules')
      seen.add(key)
    }
    return { document: { schemaVersion: 1, ...copy(d) }, hash: digest(bytes) }
  }
  /** Startup read only: absent policy is revision zero and creates no files or directories. */
  load(): Promise<void> {
    return this.ordered(async () => {
      const observed = await this.observe()
      if (this.diskHash !== null && observed.hash === null) fail('CORRUPT_STATE', 'Previously loaded skill policy disappeared; retaining the last-good policy')
      // Explicit application refresh is allowed; invalid input above preserves the last-good memory.
      const changed = this.current !== undefined && JSON.stringify(this.current) !== JSON.stringify(observed.document)
      this.current = observed.document
      this.diskHash = observed.hash
      if (changed) this.notify()
    })
  }
  snapshot(): SkillPolicySnapshot { return copy(this.ready()) }
  isEnabled(name: string, cwd?: string): boolean {
    validName(name)
    const selected = workspace(cwd)
    const rules = this.ready().rules
    const local = selected === undefined ? undefined : rules.find(rule => rule.name === name && rule.cwd === selected)
    return local?.enabled ?? rules.find(rule => rule.name === name && rule.cwd === undefined)?.enabled ?? true
  }
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  private notify(): void {
    for (const listener of [...this.listeners]) try { void Promise.resolve(listener()).catch(() => undefined) } catch { /* subscriber isolation */ }
  }
  setEnabled(name: string, enabled: boolean, expectedRevision: number, cwd?: string): Promise<void> {
    return this.ordered(async () => {
      validName(name)
      if (typeof enabled !== 'boolean' || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0) fail('INVALID_INPUT', 'A boolean state and fresh policy revision are required')
      const selected = workspace(cwd)
      const current = this.ready()
      if (current.revision !== expectedRevision) fail('CONFLICT', 'Skill policy changed; refresh before retrying')
      await noLinks(this.stateDir)
      await fs.mkdir(this.stateDir, { recursive: true, mode: 0o700 })
      await noLinks(this.stateDir)
      const directory = await fs.open(this.stateDir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW)
      try { await directory.chmod(0o700) } finally { await directory.close() }
      const lockPath = join(this.stateDir, '.skill-policy.lock')
      let lock: fs.FileHandle
      try { lock = await fs.open(lockPath, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600) }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'EEXIST') fail('BUSY', 'Another skill policy writer is active; stale locks require manual review'); throw error }
      const lockStat = await lock.stat()
      let temp: string | undefined
      try {
        await lock.writeFile(String(process.pid))
        const observed = await this.observe()
        if (this.diskHash !== null && observed.hash === null) fail('CORRUPT_STATE', 'Previously loaded skill policy disappeared; refusing to recreate it')
        if (observed.document.revision !== expectedRevision || observed.hash !== this.diskHash) fail('CONFLICT', 'Skill policy changed on disk; refusing to overwrite it')
        const rules = current.rules.map(rule => ({ ...rule }))
        const existing = rules.find(rule => rule.name === name && rule.cwd === selected)
        if (existing?.enabled === enabled) return
        if (existing) existing.enabled = enabled
        else rules.push({ name, ...(selected === undefined ? {} : { cwd: selected }), enabled })
        if (rules.length > MAX_RULES || current.revision >= Number.MAX_SAFE_INTEGER) fail('STATE_LIMIT', 'Skill policy exceeds its safe limits')
        rules.sort((a, b) => a.name.localeCompare(b.name) || (a.cwd ?? '').localeCompare(b.cwd ?? ''))
        const next: Document = { schemaVersion: 1, revision: current.revision + 1, rules }
        const raw = `${JSON.stringify(next)}\n`
        if (Buffer.byteLength(raw) > MAX_BYTES) fail('STATE_LIMIT', 'Skill policy exceeds its size limit')
        temp = join(this.stateDir, `.skill-policy-${randomUUID()}.tmp`)
        const output = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
        try { await output.chmod(0o600); await output.writeFile(raw); await output.sync() } finally { await output.close() }
        if ((await this.observe()).hash !== observed.hash) fail('CONFLICT', 'Skill policy changed before commit')
        await noLinks(this.stateDir)
        await fs.rename(temp, this.path())
        temp = undefined
        this.current = next
        this.diskHash = digest(raw)
        // A broken consumer cannot roll back a durable setting or stop other consumers from invalidating.
        this.notify()
      } finally {
        try { if (temp) await fs.unlink(temp).catch(error => { if (!missing(error)) throw error }) }
        finally {
          await lock.close()
          const now = await fs.lstat(lockPath).catch(() => undefined)
          if (now?.ino === lockStat.ino && now.dev === lockStat.dev) await fs.unlink(lockPath)
        }
      }
    })
  }
}
