/** Async filesystem-only Skills engine. No Harness services or user-controlled write paths. */
import { constants } from 'node:fs'
import * as fs from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { isMap, isScalar, parseDocument } from 'yaml'
import type { ImportItem, ImportResult, ScannedSkill, SkillDetail, SkillSource, SkillSummary, TrashItem } from './protocol.ts'

export interface SkillsManagerOptions {
  stateDir: string
  dshHome: string
  agentsHome: string
  workspacePaths: () => string[]
}
interface Root { path: string; source: SkillSource }
interface Snapshot { revision: string; raw: string; linked: boolean; files: Array<{ path: string; bytes: Buffer; mode: number }>; directories: string[] }
interface Found { summary: SkillSummary; root: Root; target: string; snapshot: Snapshot }
interface Backup { original: string; disabled: string }
interface Trashed extends TrashItem { root: Root; target: string; payload: string; revision: string; kind: 'bundle' | 'file' }
interface State { version: 1; backups: Record<string, Backup>; trash: Trashed[] }
interface Grant { root: string; target: string; kind: 'bundle' | 'file'; revision: string; name: string }
const queues = new Map<string, Promise<unknown>>()
const MAX_FILE = 8 * 1024 * 1024
const MAX_TOTAL = 64 * 1024 * 1024
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')
const inside = (root: string, path: string) => { const r = relative(root, path); return r === '' || (!r.startsWith(`..${sep}`) && r !== '..' && !isAbsolute(r)) }
function fail(code: string, message: string): never { throw Object.assign(new Error(message), { code }) }
function missing(e: unknown): boolean { return (e as NodeJS.ErrnoException).code === 'ENOENT' }
async function exists(path: string) { try { await fs.lstat(path); return true } catch (e) { if (missing(e)) return false; throw e } }
async function links(path: string): Promise<boolean> {
  let current = resolve(path)
  for (;;) {
    try { if ((await fs.lstat(current)).isSymbolicLink()) return true } catch (e) { if (!missing(e)) throw e }
    const parent = dirname(current)
    if (parent === current) return false
    current = parent
  }
}
async function regularRead(path: string): Promise<Buffer> {
  const handle = await fs.open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK)
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size > MAX_FILE) fail('UNSAFE_FILE', 'Expected a regular file of at most 8 MiB')
    const data = await handle.readFile()
    if (data.length > MAX_FILE) fail('UNSAFE_FILE', 'File grew beyond the size limit')
    return data
  } finally { await handle.close() }
}
async function exclusiveWrite(path: string, bytes: Buffer, mode: number): Promise<void> {
  const handle = await fs.open(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600)
  try {
    await handle.writeFile(bytes)
    // Keep private read/write permissions and the source execution bits, regardless of process umask.
    await handle.chmod(mode)
  } finally { await handle.close() }
}
function documentText(bytes: Buffer): string {
  const raw = bytes.toString('utf8')
  if (!Buffer.from(raw, 'utf8').equals(bytes)) fail('INVALID_SKILL', 'Skill document must be valid UTF-8')
  return raw
}
function frontmatter(raw: string) {
  const opening = /^(?:\uFEFF)?---[ \t]*\r?\n/.exec(raw)
  if (!opening) fail('INVALID_SKILL', 'Skill must start with YAML frontmatter')
  const rest = raw.slice(opening[0].length)
  const closing = /^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(rest)
  if (!closing) fail('INVALID_SKILL', 'Missing frontmatter closing delimiter')
  const start = opening[0].length
  const end = start + closing.index
  const doc = parseDocument(raw.slice(start, end), { keepSourceTokens: true, uniqueKeys: true })
  if (doc.errors.length || !isMap(doc.contents)) fail('INVALID_SKILL', 'Malformed YAML frontmatter')
  let data: Record<string, unknown>
  try { data = doc.toJS({ maxAliasCount: 50 }) as Record<string, unknown> }
  catch { fail('INVALID_SKILL', 'Unsafe or unresolved YAML aliases') }
  if (typeof data.name !== 'string' || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.name) || typeof data.description !== 'string' || !data.description.trim()) fail('INVALID_SKILL', 'Skill requires a lowercase kebab-case name and description')
  return { doc, data, start, end, body: raw.slice(end + closing[0].length), eol: opening[0].endsWith('\r\n') ? '\r\n' : '\n' }
}
function invocationBool(value: unknown, fallback: boolean): boolean {
  if (value === undefined) return fallback
  if (typeof value === 'boolean') return value
  if (value === 0 || value === 1) return value === 1
  if (typeof value === 'string') {
    if (/^(true|yes|on|1)$/i.test(value)) return true
    if (/^(false|no|off|0)$/i.test(value)) return false
  }
  fail('INVALID_SKILL', 'Invocation flags must be booleans, 0/1, or recognized boolean strings')
}
function parse(raw: string) {
  const fm = frontmatter(raw)
  const disabled = invocationBool(fm.data['disable-model-invocation'], false)
  const user = invocationBool(fm.data['user-invocable'], true)
  return { name: fm.data.name as string, description: fm.data.description as string, whenToUse: typeof fm.data.whenToUse === 'string' ? fm.data.whenToUse : '', enabled: !disabled || user, content: fm.body }
}
/** Replace only the two scalar value spans. Other YAML, comments, body and EOLs stay byte-identical. */
function invocation(raw: string, enabled: boolean): string {
  const fm = frontmatter(raw)
  const replacements: Array<{ start: number; end: number; text: string }> = []
  const additions: string[] = []
  for (const [key, value] of [['disable-model-invocation', !enabled], ['user-invocable', enabled]] as const) {
    const node = fm.doc.get(key, true)
    if (node === undefined) { additions.push(`${key}: ${value}${fm.eol}`); continue }
    if (!isScalar(node) || !node.range) fail('UNSAFE_YAML', 'Invocation flags must be scalar values, not aliases or collections')
    replacements.push({ start: fm.start + node.range[0], end: fm.start + node.range[1], text: String(value) })
  }
  if (additions.length) replacements.push({ start: fm.end, end: fm.end, text: additions.join('') })
  for (const edit of replacements.sort((a, b) => b.start - a.start)) raw = raw.slice(0, edit.start) + edit.text + raw.slice(edit.end)
  // Aliases, anchors, or flow maps may make an otherwise local edit unsafe. Never write invalid YAML.
  frontmatter(raw)
  return raw
}

export class SkillsManager {
  private readonly options: SkillsManagerOptions
  private readonly grants = new Map<string, Grant>()
  constructor(options: SkillsManagerOptions) {
    this.options = { ...options, stateDir: resolve(options.stateDir), dshHome: resolve(options.dshHome), agentsHome: resolve(options.agentsHome) }
  }
  private ordered<T>(fn: () => Promise<T>): Promise<T> {
    const key = this.options.stateDir
    const task = (queues.get(key) ?? Promise.resolve()).catch(() => undefined).then(fn)
    const tail = task.catch(() => undefined)
    queues.set(key, tail)
    void tail.finally(() => { if (queues.get(key) === tail) queues.delete(key) })
    return task
  }
  private async roots(cwd?: string): Promise<Root[]> {
    const roots: Root[] = []
    if (cwd !== undefined) {
      if (!isAbsolute(cwd)) fail('INVALID_WORKSPACE', 'Workspace must be an absolute registered path')
      const selected = resolve(cwd)
      if (!this.options.workspacePaths().some(path => resolve(path) === selected)) fail('INVALID_WORKSPACE', 'Workspace is not registered')
      // A registered workspace is the authorization boundary. Never discover an ancestor repository outside it.
      if (!(await fs.stat(selected)).isDirectory()) fail('INVALID_WORKSPACE', 'Workspace is not a directory')
      roots.push({ path: join(selected, '.dsh', 'skills'), source: 'project-dsh' }, { path: join(selected, '.agents', 'skills'), source: 'project-agents' })
    }
    roots.push({ path: join(this.options.dshHome, 'skills'), source: 'user-dsh' }, { path: join(this.options.agentsHome, 'skills'), source: 'user-agents' })
    return roots
  }
  private async snapshot(root: string, target: string, kind: 'bundle' | 'file', capture = false): Promise<Snapshot> {
    if (!inside(root, target) || target === root) fail('UNSAFE_PATH', 'Target is outside its authorized root')
    const realRoot = await fs.realpath(root)
    const realTarget = await fs.realpath(target)
    if (!inside(realRoot, realTarget) || realTarget === realRoot) fail('UNSAFE_PATH', 'Symlink escapes the authorized root')
    let linked = await links(target)
    let total = 0; let count = 0
    const records: string[] = []
    const files: Snapshot['files'] = []; const directories: string[] = []
    let raw = ''
    const skillFile = kind === 'bundle' ? join(target, 'SKILL.md') : target
    const walk = async (path: string): Promise<void> => {
      if (++count > 4096) fail('UNSAFE_FILE', 'Skill contains too many entries')
      const realPath = await fs.realpath(path)
      if (!inside(realRoot, realPath)) fail('UNSAFE_PATH', 'Path escaped its authorized root during scanning')
      const stat = await fs.lstat(path)
      if (stat.isSymbolicLink()) {
        linked = true
        const real = await fs.realpath(path)
        if (!inside(realRoot, real)) fail('UNSAFE_PATH', 'Symlink escapes the authorized root')
        const targetStat = await fs.stat(path)
        if (targetStat.isDirectory()) {
          records.push(`${relative(target, path)}\0linkdir\0${await fs.readlink(path)}`)
          // A direct bundle alias can be displayed read-only. Never recurse resource-directory aliases.
          if (path === target) for (const name of (await fs.readdir(path)).sort()) await walk(join(path, name))
        } else if (targetStat.isFile()) {
          const bytes = await regularRead(real)
          total += bytes.length
          records.push(`${relative(target, path)}\0link\0${await fs.readlink(path)}\0${hash(bytes)}`)
          if (path === skillFile) raw = documentText(bytes)
        } else fail('UNSAFE_FILE', 'Linked special filesystem objects cannot be managed')
      } else if (stat.isDirectory()) {
        records.push(`${relative(target, path)}\0dir`)
        directories.push(relative(target, path))
        for (const name of (await fs.readdir(path)).sort()) await walk(join(path, name))
      } else if (stat.isFile()) {
        const bytes = await regularRead(path)
        total += bytes.length
        const mode = 0o600 | (stat.mode & 0o111)
        records.push(`${relative(target, path)}\0file\0${mode}\0${hash(bytes)}`)
        if (capture) files.push({ path: relative(target, path), bytes, mode })
        if (path === skillFile) raw = documentText(bytes)
      } else fail('UNSAFE_FILE', 'Special filesystem objects cannot be managed')
      if (total > MAX_TOTAL) fail('UNSAFE_FILE', 'Skill exceeds the 64 MiB size limit')
    }
    await walk(target)
    if (!raw) fail('INVALID_SKILL', 'Missing skill document')
    parse(raw)
    return { revision: hash(records.join('\n')), raw, linked, files, directories }
  }
  /** An explicitly linked skill is readable even outside the managed root.
   * Only its instruction file is opened; linked resources are not traversed.
   * This snapshot is never eligible for mutation or import.
   */
  private async linkedSnapshot(root: string, target: string, kind: 'bundle' | 'file'): Promise<Snapshot> {
    if (dirname(target) !== root || !inside(root, target) || target === root) fail('UNSAFE_PATH', 'Linked skill must be a direct entry of an authorized root')
    const instruction = kind === 'bundle' ? join(target, 'SKILL.md') : target
    const realTarget = await fs.realpath(target)
    const realInstruction = await fs.realpath(instruction)
    const bytes = await regularRead(realInstruction)
    if (await fs.realpath(target) !== realTarget || await fs.realpath(instruction) !== realInstruction) fail('UNSAFE_PATH', 'Linked skill changed while reading')
    const raw = documentText(bytes)
    parse(raw)
    return { revision: hash(`linked\0${kind}\0${realTarget}\0${realInstruction}\0${hash(bytes)}`), raw, linked: true, files: [], directories: [] }
  }
  private async discover(cwd?: string): Promise<Found[]> {
    const result: Found[] = []; const seen = new Set<string>()
    for (const root of await this.roots(cwd)) {
      let names: string[]
      try { names = await fs.readdir(root.path) } catch (e) { if (missing(e)) continue; throw e }
      for (const name of names.sort()) {
        if (name.startsWith('.')) continue
        const target = join(root.path, name)
        let linked = false
        try {
          linked = await links(target)
          const stat = await fs.stat(target)
          const kind = stat.isDirectory() ? 'bundle' : stat.isFile() && name.endsWith('.md') ? 'file' : undefined
          if (!kind) continue
          const path = kind === 'bundle' ? join(target, 'SKILL.md') : target
          linked = linked || await links(path)
          const snapshot = linked
            ? await this.linkedSnapshot(root.path, target, kind)
            : await this.snapshot(root.path, target, kind)
          if (seen.has(path)) continue
          seen.add(path)
          const { content: _content, ...parsed } = parse(snapshot.raw)
          const id = hash(`${root.source}\0${root.path}\0${name}`)
          result.push({ summary: { ...parsed, id, revision: snapshot.revision, source: root.source, level: root.source.startsWith('project-') ? 'project' : 'user', kind, path, writable: !snapshot.linked, ...(snapshot.linked ? { readOnlyReason: 'Symlinked paths are read-only' } : {}) }, root, target, snapshot })
        } catch (e) {
          const code = (e as NodeJS.ErrnoException).code
          // An external alias is optional discovery, not a dependency of every
          // local skill. Permission changes on its target must not break the list.
          if (linked && ['EACCES', 'EPERM', 'ENOTDIR'].includes(code ?? '')) continue
          if (!['ENOENT', 'ELOOP', 'UNSAFE_PATH', 'UNSAFE_FILE', 'INVALID_SKILL', 'UNSAFE_YAML'].includes(code ?? '')) throw e
        }
      }
    }
    return result.sort((a, b) => (a.summary.level === b.summary.level ? a.summary.name.localeCompare(b.summary.name) : a.summary.level === 'project' ? -1 : 1))
  }
  private async find(id: string, cwd?: string): Promise<Found> {
    if (!/^[a-f0-9]{64}$/.test(id)) fail('NOT_FOUND', 'Unknown skill ID')
    const found = (await this.discover(cwd)).find(item => item.summary.id === id)
    if (!found) fail('NOT_FOUND', 'Skill is no longer present in an authorized root')
    return found
  }
  private async checked(found: Found, revision: string): Promise<Snapshot> {
    if (!found.summary.writable) fail('READ_ONLY', 'Symlinked skills are read-only')
    const next = await this.snapshot(found.root.path, found.target, found.summary.kind)
    if (next.linked) fail('READ_ONLY', 'Symlinked skills are read-only')
    if (next.revision !== revision) fail('REVISION_CONFLICT', 'Skill changed; refresh before retrying')
    return next
  }
  listSkills(cwd?: string): Promise<SkillSummary[]> { return this.ordered(async () => (await this.discover(cwd)).map(item => item.summary)) }
  readSkill(id: string, cwd?: string): Promise<SkillDetail> { return this.ordered(async () => { const found = await this.find(id, cwd); return { ...found.summary, content: parse(found.snapshot.raw).content } }) }
  private statePath() { return join(this.options.stateDir, 'skills-state.json') }
  private async loadState(): Promise<{ state: State; revision: string | null }> {
    try {
      if (await links(this.options.stateDir) || await links(this.statePath())) fail('UNSAFE_STATE', 'State paths must not contain symlinks')
      const bytes = await regularRead(this.statePath())
      const state = JSON.parse(bytes.toString('utf8')) as State
      if (state.version !== 1 || !state.backups || typeof state.backups !== 'object' || Array.isArray(state.backups) || !Array.isArray(state.trash)) throw new Error('invalid shape')
      for (const backup of Object.values(state.backups)) if (!backup || typeof backup.original !== 'string' || typeof backup.disabled !== 'string') throw new Error('invalid backup')
      for (const item of state.trash) {
        if (!item || !/^[a-f0-9-]{36}$/.test(item.id) || item.payload !== join(this.options.stateDir, 'trash', item.id) || !item.root || !isAbsolute(item.root.path) || !inside(item.root.path, item.target) || item.target === item.root.path || dirname(item.target) !== item.root.path || !['bundle', 'file'].includes(item.kind) || typeof item.revision !== 'string' || item.originalPath !== item.target) throw new Error('invalid trash entry')
      }
      return { state, revision: hash(bytes) }
    } catch (e) { if (missing(e)) return { state: { version: 1, backups: {}, trash: [] }, revision: null }; if ((e as { code?: string }).code === 'UNSAFE_STATE') throw e; fail('CORRUPT_STATE', 'Skills state is corrupt; refusing to write') }
  }
  private async saveState(state: State, revision: string | null): Promise<string> {
    const current = await this.loadState()
    if (current.revision !== revision) fail('REVISION_CONFLICT', 'Skills state changed in another process')
    const path = this.statePath(); const temp = join(this.options.stateDir, `.state-${randomUUID()}`)
    const raw = JSON.stringify(state)
    if (Buffer.byteLength(raw) > MAX_FILE) fail('STATE_LIMIT', 'Skills state exceeds the safe size limit; no files were changed')
    const handle = await fs.open(temp, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600)
    try { await handle.writeFile(raw); await handle.sync() } finally { await handle.close() }
    try {
      if ((await this.loadState()).revision !== revision || await links(this.options.stateDir)) fail('REVISION_CONFLICT', 'Skills state changed before commit')
      await fs.rename(temp, path)
    } finally { if (await exists(temp)) await fs.unlink(temp) }
    return hash(raw)
  }
  private async mutation<T>(fn: (state: State, revision: string | null) => Promise<T>): Promise<T> {
    return this.ordered(async () => {
      if (await links(this.options.stateDir)) fail('UNSAFE_STATE', 'State paths must not contain symlinks')
      await fs.mkdir(this.options.stateDir, { recursive: true, mode: 0o700 })
      if (await links(this.options.stateDir)) fail('UNSAFE_STATE', 'State directory changed')
      const lockPath = join(this.options.stateDir, '.skills.lock')
      let lock: fs.FileHandle
      try { lock = await fs.open(lockPath, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600) }
      catch (e) { if ((e as NodeJS.ErrnoException).code === 'EEXIST') fail('BUSY', 'Another Skills operation is active; retry after it finishes (stale locks require manual review)'); throw e }
      try { await lock.writeFile(String(process.pid)); const { state, revision } = await this.loadState(); return await fn(state, revision) }
      finally { await lock.close(); await fs.unlink(lockPath) }
    })
  }
  setSkillEnabled(id: string, enabled: boolean, revision: string, cwd?: string): Promise<void> {
    return this.mutation(async (state, stateRevision) => {
      const found = await this.find(id, cwd)
      const current = await this.checked(found, revision)
      const backup = state.backups[id]
      let next: string
      if (enabled && backup) {
        if (hash(current.raw) !== backup.disabled && current.raw !== backup.original) fail('BACKUP_CONFLICT', 'Disabled skill was edited; refusing to overwrite those edits')
        next = backup.original
      } else if (enabled === parse(current.raw).enabled) return
      else next = invocation(current.raw, enabled)
      if (!enabled && !backup) state.backups[id] = { original: current.raw, disabled: hash(next) }
      // Persist the original first: a failed file write must never lose the user's original invocation policy.
      stateRevision = await this.saveState(state, stateRevision)
      const temp = join(found.root.path, `.skill-${randomUUID()}`)
      const mode = (await fs.stat(found.summary.path)).mode & 0o777
      const handle = await fs.open(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, mode)
      try { await handle.writeFile(next); await handle.sync() } finally { await handle.close() }
      try { await this.checked(found, revision); await fs.rename(temp, found.summary.path) }
      finally { if (await exists(temp)) await fs.unlink(temp) }
      if (enabled && backup) { delete state.backups[id]; await this.saveState(state, stateRevision) }
    })
  }
  deleteSkill(id: string, revision: string, cwd?: string): Promise<void> {
    return this.mutation(async (state, stateRevision) => {
      const found = await this.find(id, cwd)
      await this.checked(found, revision)
      const trashDir = join(this.options.stateDir, 'trash')
      if (await links(trashDir)) fail('UNSAFE_STATE', 'Trash must not contain symlinks')
      await fs.mkdir(trashDir, { recursive: true, mode: 0o700 })
      const trashId = randomUUID()
      const item: Trashed = { id: trashId, name: found.summary.name, originalPath: found.target, deletedAt: new Date().toISOString(), root: found.root, target: found.target, payload: join(trashDir, trashId), revision, kind: found.summary.kind }
      // Write the recovery intent before moving. Pending entries are visible only when payload exists.
      state.trash.push(item)
      stateRevision = await this.saveState(state, stateRevision)
      try { await this.checked(found, revision); await fs.rename(found.target, item.payload) }
      catch (e) { state.trash = state.trash.filter(entry => entry.id !== trashId); await this.saveState(state, stateRevision); throw e }
    })
  }
  listTrash(): Promise<TrashItem[]> {
    return this.ordered(async () => {
      const { state } = await this.loadState(); const result: TrashItem[] = []
      for (const item of state.trash) if (await exists(item.payload)) result.push({ id: item.id, name: item.name, originalPath: item.originalPath, deletedAt: item.deletedAt })
      return result
    })
  }
  restoreSkill(id: string): Promise<void> {
    return this.mutation(async (state, stateRevision) => {
      const item = state.trash.find(entry => entry.id === id)
      if (!item) fail('NOT_FOUND', 'Unknown trash ID')
      const roots = await this.roots()
      if (item.root.source.startsWith('project-')) {
        const marker = item.root.source === 'project-dsh' ? '.dsh' : '.agents'
        const workspace = this.options.workspacePaths().find(path => join(resolve(path), marker, 'skills') === item.root.path)
        if (!workspace) fail('UNSAFE_PATH', 'Original workspace is no longer registered')
        // Validate only the owning workspace: unrelated stale registry entries must not block recovery.
        roots.push(...await this.roots(resolve(workspace)))
      }
      if (!roots.some(root => root.path === item.root.path && root.source === item.root.source)) fail('UNSAFE_PATH', 'Original workspace is no longer registered')
      if (await links(item.root.path) || await links(item.payload)) fail('READ_ONLY', 'Restore paths must not contain symlinks')
      if (await exists(item.target)) fail('ALREADY_EXISTS', 'Restore would overwrite an existing skill')
      const snap = await this.snapshot(join(this.options.stateDir, 'trash'), item.payload, item.kind)
      if (snap.linked || snap.revision !== item.revision) fail('REVISION_CONFLICT', 'Trash payload changed')
      await fs.mkdir(item.root.path, { recursive: true })
      if (await links(item.root.path) || await exists(item.target)) fail('UNSAFE_PATH', 'Restore destination changed')
      const latest = await this.snapshot(join(this.options.stateDir, 'trash'), item.payload, item.kind)
      if (latest.linked || latest.revision !== item.revision) fail('REVISION_CONFLICT', 'Trash payload changed before restore')
      if (await links(item.root.path)) fail('READ_ONLY', 'Restore destination changed')
      if (item.kind === 'file') {
        // link() is an atomic no-overwrite publish on the same filesystem used by trash rename().
        await fs.link(item.payload, item.target)
        const [payloadStat, targetStat] = await Promise.all([fs.lstat(item.payload), fs.lstat(item.target)])
        if (payloadStat.ino !== targetStat.ino || payloadStat.dev !== targetStat.dev) fail('REVISION_CONFLICT', 'Restore destination changed; trash backup retained')
        await fs.unlink(item.payload)
      } else {
        // Reserve an empty destination exclusively. rename cannot overwrite nonempty directories or symlinks.
        await fs.mkdir(item.target, { mode: 0o700 })
        const reserved = await fs.lstat(item.target)
        try { await fs.rename(item.payload, item.target) }
        catch (error) {
          const current = await fs.lstat(item.target).catch(() => undefined)
          if (current?.ino === reserved.ino && current.dev === reserved.dev) await fs.rmdir(item.target).catch(() => undefined)
          throw error
        }
      }
      state.trash = state.trash.filter(entry => entry.id !== id)
      await this.saveState(state, stateRevision)
    })
  }
  scanSkills(dir: string): Promise<ScannedSkill[]> {
    return this.ordered(async () => {
      if (!isAbsolute(dir)) fail('UNSAFE_PATH', 'Scan directory must be absolute')
      const root = await fs.realpath(dir)
      if (!(await fs.stat(root)).isDirectory()) fail('UNSAFE_PATH', 'Scan target is not a directory')
      const output: ScannedSkill[] = []
      for (const name of (await fs.readdir(root)).sort()) {
        if (name.startsWith('.')) continue
        const target = join(root, name)
        try {
          const stat = await fs.lstat(target)
          const kind = stat.isDirectory() ? 'bundle' : stat.isFile() && name.endsWith('.md') ? 'file' : undefined
          if (!kind) continue
          const snap = await this.snapshot(root, target, kind)
          if (snap.linked) continue
          const parsed = parse(snap.raw); const id = randomUUID()
          if (this.grants.size >= 2048) this.grants.delete(this.grants.keys().next().value!)
          this.grants.set(id, { root, target, kind, revision: snap.revision, name: parsed.name })
          output.push({ id, revision: snap.revision, name: parsed.name, description: parsed.description, sourcePath: target, kind })
        } catch (e) { if (!['ENOENT', 'UNSAFE_PATH', 'UNSAFE_FILE', 'INVALID_SKILL'].includes((e as NodeJS.ErrnoException).code ?? '')) throw e }
      }
      return output
    })
  }
  importSkills(items: ImportItem[]): Promise<ImportResult[]> {
    return this.mutation(async () => {
      const output: ImportResult[] = []
      const destRoot = join(this.options.dshHome, 'skills')
      for (const item of items) {
        const grant = this.grants.get(item.id)
        const name = grant?.name ?? 'Unknown skill'
        try {
          if (!grant) fail('INVALID_SCAN', 'Unknown or expired scan ID; scan again')
          if (await links(grant.root) || await fs.realpath(grant.root) !== grant.root) fail('UNSAFE_PATH', 'Scan root changed; scan again')
          const snap = await this.snapshot(grant.root, grant.target, grant.kind, true)
          if (snap.linked || snap.revision !== item.revision || snap.revision !== grant.revision) fail('REVISION_CONFLICT', 'Scanned source changed; scan again')
          if (await links(destRoot)) fail('READ_ONLY', 'Import destination must not contain symlinks')
          await fs.mkdir(destRoot, { recursive: true })
          const dest = join(destRoot, basename(grant.target))
          if (await exists(dest)) fail('ALREADY_EXISTS', 'A skill with this filename already exists')
          // Reserve the destination exclusively. Never cp()/rename() over an existing directory.
          if (grant.kind === 'file') {
            const bytes = snap.files[0].bytes
            const latest = await this.snapshot(grant.root, grant.target, grant.kind)
            if (latest.linked || latest.revision !== snap.revision) fail('REVISION_CONFLICT', 'Source changed before import')
            if (await links(destRoot)) fail('READ_ONLY', 'Import destination changed')
            await exclusiveWrite(dest, bytes, snap.files[0].mode)
          } else {
            const staging = join(destRoot, `.import-${randomUUID()}`)
            await fs.mkdir(staging, { mode: 0o700 })
            // Copy captured, revision-checked bytes, never re-follow a source path during copying.
            // Retain hidden staging on any partial failure for manual recovery.
            for (const directory of snap.directories) if (directory) await fs.mkdir(join(staging, directory), { mode: 0o700 })
            for (const file of snap.files) await exclusiveWrite(join(staging, file.path), file.bytes, file.mode)
            const copied = await this.snapshot(destRoot, staging, 'bundle')
            const current = await this.snapshot(grant.root, grant.target, 'bundle')
            if (copied.linked || current.linked || copied.revision !== snap.revision || current.revision !== snap.revision) fail('REVISION_CONFLICT', 'Source changed during import')
            if (await links(destRoot)) fail('READ_ONLY', 'Import destination changed')
            await fs.mkdir(dest, { mode: 0o700 })
            // Exclusive mkdir above means imports never replace an existing bundle. Publish its children without overwrite.
            for (const entry of await fs.readdir(staging)) await fs.rename(join(staging, entry), join(dest, entry))
            await fs.rmdir(staging)
          }
          output.push({ name, ok: true })
        } catch (e) { output.push({ name, ok: false, reason: (e as Error).message }) }
      }
      return output
    })
  }
}
