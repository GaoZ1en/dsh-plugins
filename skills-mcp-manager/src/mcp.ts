/** Profile-local MCP configuration and connection ownership. No SDK or secret storage here. */
import { constants } from 'node:fs'
import { access, mkdir, open, rename, unlink } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import type { McpList, McpServerConfig, McpServerSummary } from './protocol.ts'

export interface McpHandle { dispose(): Promise<void>; toolCount(): number }
export interface McpManagerOptions {
  stateDir: string
  resolveCredential: (ref: string) => Promise<string | undefined>
  nativeServers: () => Promise<McpServerSummary[]>
  /** Public profile lifecycle adapter; never copies or rewrites a native server configuration. */
  nativeSetEnabled?: (id: string, enabled: boolean) => Promise<void>
  /** Must abort/dispose its scope when signal aborts, including during initial connection. */
  connect: (config: McpServerConfig, resolved: { env: Record<string, string>; headers: Record<string, string>; signal?: AbortSignal }, probe: boolean) => Promise<McpHandle>
  legacyPath?: string
  connectTimeoutMs?: number
}
interface Document { schemaVersion: 1; revision: number; servers: McpServerConfig[] }
interface Live {
  config: McpServerConfig
  controller: AbortController
  status: 'loading' | 'loaded' | 'failed'
  error?: string
  handle?: McpHandle
  task: Promise<void>
  /** Actual adapter settlement plus any late-handle disposal, not the deadline race. */
  cleanup: Promise<void>
}
export class McpManagerError extends Error {
  readonly code: string
  constructor(code: string, message: string) { super(message); this.code = code; this.name = 'McpManagerError' }
}
function fail(code: string, message: string): never { throw new McpManagerError(code, message) }
const badKeys = new Set(['__proto__', 'prototype', 'constructor'])
const configKeys = new Set(['id', 'name', 'transport', 'enabled', 'command', 'args', 'envRefs', 'cwd', 'url', 'headerRefs'])
const MAX_BYTES = 1_048_576
const CLEANUP_GRACE_MS = 1_000
function record(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value))
}
function text(value: unknown, max: number, empty = false): value is string {
  return typeof value === 'string' && (empty || value.length > 0) && value.length <= max && !/[\x00-\x1f\x7f]/.test(value)
}
function refs(value: unknown, header: boolean): Record<string, string> {
  if (!record(value) || Object.keys(value).length > 128) fail('INVALID_INPUT', 'Invalid credential references')
  const out: Record<string, string> = {}
  const seen = new Set<string>()
  for (const [key, ref] of Object.entries(value)) {
    if (badKeys.has(key) || key.length > 128 || !(header ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/ : /^[A-Za-z_][A-Za-z0-9_]*$/).test(key)
      || !text(ref, 256) || !/^[A-Za-z_][A-Za-z0-9_.:/-]*$/.test(ref) || badKeys.has(ref)) fail('INVALID_INPUT', 'Invalid credential reference')
    if (seen.has(header ? key.toLowerCase() : key)) fail('INVALID_INPUT', 'Duplicate credential reference key')
    seen.add(header ? key.toLowerCase() : key)
    out[key] = ref
  }
  return out
}
/** Validation never includes untrusted config or credential values in error messages. */
export function normalizeMcpServer(input: McpServerConfig): McpServerConfig {
  if (!record(input) || Object.keys(input).some(key => !configKeys.has(key))) fail('INVALID_INPUT', 'Unknown server fields (raw env/headers are forbidden)')
  if (!text(input.name, 32) || !/^[A-Za-z0-9_-]+$/.test(input.name) || badKeys.has(input.name)) fail('INVALID_INPUT', 'Invalid server name')
  if (input.id !== undefined && (!text(input.id, 128) || !/^[A-Za-z0-9_-]+$/.test(input.id) || badKeys.has(input.id))) fail('INVALID_INPUT', 'Invalid server ID')
  if (typeof input.enabled !== 'boolean') fail('INVALID_INPUT', 'enabled must be boolean')
  const out: McpServerConfig = { ...(input.id === undefined ? {} : { id: input.id }), name: input.name, transport: input.transport, enabled: input.enabled }
  if (input.transport === 'stdio') {
    if (!text(input.command, 4096) || input.command.trim() !== input.command || input.command.length === 0) fail('INVALID_INPUT', 'Invalid command')
    if (input.url !== undefined || input.headerRefs !== undefined) fail('INVALID_INPUT', 'Unexpected HTTP configuration')
    out.command = input.command
    if (input.args !== undefined) {
      if (!Array.isArray(input.args) || input.args.length > 256 || ![...input.args].every(arg => text(arg, 8192, true))) fail('INVALID_INPUT', 'Invalid command arguments')
      out.args = [...input.args]
    }
    if (input.cwd !== undefined) {
      if (!text(input.cwd, 4096) || !isAbsolute(input.cwd)) fail('INVALID_INPUT', 'cwd must be an absolute path')
      out.cwd = input.cwd
    }
    if (input.envRefs !== undefined) out.envRefs = refs(input.envRefs, false)
  } else if (input.transport === 'streamable-http') {
    if (input.command !== undefined || input.args !== undefined || input.cwd !== undefined || input.envRefs !== undefined) fail('INVALID_INPUT', 'Unexpected stdio configuration')
    if (!text(input.url, 8192) || input.url.trim() !== input.url) fail('INVALID_INPUT', 'Invalid HTTP URL')
    let url: URL
    try { url = new URL(input.url) } catch { fail('INVALID_INPUT', 'Invalid HTTP URL') }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.hash) fail('INVALID_INPUT', 'Only HTTP(S) URLs without userinfo or fragments are supported')
    out.url = input.url
    if (input.headerRefs !== undefined) out.headerRefs = refs(input.headerRefs, true)
  } else fail('INVALID_INPUT', 'Invalid transport')
  return out
}
export function validateMcpServer(input: unknown): string | null {
  try { normalizeMcpServer(input as McpServerConfig); return null } catch { return 'Invalid MCP server configuration' }
}
function count(handle?: McpHandle): number {
  try { const n = handle?.toolCount() ?? 0; return Number.isSafeInteger(n) && n >= 0 ? n : 0 } catch { return 0 }
}

export class McpManager {
  private readonly target: string
  private readonly lock: string
  private readonly live = new Map<string, Live>()
  private readonly probes = new Set<AbortController>()
  private readonly probeTasks = new Set<Promise<unknown>>()
  private readonly pendingCleanup = new Set<Promise<void>>()
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  private readonly timeout: number
  private readonly opts: McpManagerOptions
  constructor(opts: McpManagerOptions) {
    this.opts = opts
    this.target = join(resolve(opts.stateDir), 'mcp.json')
    this.lock = `${this.target}.lock`
    this.timeout = opts.connectTimeoutMs ?? 15_000
    if (!Number.isSafeInteger(this.timeout) || this.timeout < 1 || this.timeout > 300_000) fail('INVALID_INPUT', 'Invalid connection deadline')
  }
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.queue.then(fn)
    this.queue = task.catch(() => {})
    return task
  }
  private active(): void { if (this.disposed) fail('DISPOSED', 'MCP manager is disposed') }
  private async readDocument(): Promise<Document> {
    try {
      // Refuse symlinks and over-sized documents; read-only paths create nothing.
      const handle = await open(this.target, constants.O_RDONLY | constants.O_NOFOLLOW)
      let raw: string
      try {
        const stat = await handle.stat()
        if (!stat.isFile() || stat.size > MAX_BYTES) fail('CORRUPT_CONFIG', 'Invalid MCP configuration document')
        raw = await handle.readFile('utf8')
      } finally { await handle.close() }
      const data: unknown = JSON.parse(raw)
      if (!record(data) || Object.keys(data).some(key => !['schemaVersion', 'revision', 'servers'].includes(key)) || data.schemaVersion !== 1
        || !Number.isSafeInteger(data.revision) || (data.revision as number) < 0 || !Array.isArray(data.servers) || data.servers.length > 256) throw new Error()
      const ids = new Set<string>(), names = new Set<string>()
      const servers = data.servers.map(value => {
        const s = normalizeMcpServer(value)
        if (!s.id || ids.has(s.id) || names.has(s.name)) throw new Error()
        ids.add(s.id); names.add(s.name)
        return s
      })
      return { schemaVersion: 1, revision: data.revision as number, servers }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'ENOENT') return { schemaVersion: 1, revision: 0, servers: [] }
      fail('CORRUPT_CONFIG', 'MCP configuration is unreadable or corrupt; no changes were made')
    }
  }
  private async natives(): Promise<McpServerSummary[]> {
    // Whitelist projection: never echo arbitrary provider fields, raw env/headers or errors.
    let input: McpServerSummary[]
    try { input = await this.opts.nativeServers() } catch { fail('NATIVE_UNAVAILABLE', 'Native MCP inventory unavailable') }
    return input.map(s => ({ id: s.id, name: s.name, transport: s.transport, enabled: s.enabled, status: 'external', toolCount: Number.isSafeInteger(s.toolCount) && s.toolCount >= 0 ? s.toolCount : 0, source: 'native', writable: false, toggleable: !!this.opts.nativeSetEnabled && s.toggleable === true }))
  }
  async list(): Promise<McpList> {
    const [doc, native] = await Promise.all([this.readDocument(), this.natives()])
    const servers: McpServerSummary[] = doc.servers.map(s => {
      const live = this.live.get(s.id!)
      const same = live && JSON.stringify(live.config) === JSON.stringify(s)
      const blocked = live?.status === 'failed' && live.controller.signal.aborted
      return { ...s, id: s.id!, status: blocked ? 'failed' : s.enabled && same ? live.status : 'stopped', ...((same || blocked) && live?.error ? { error: live.error } : {}), toolCount: same ? count(live.handle) : 0, source: 'managed', writable: true }
    })
    const persisted = new Set(doc.servers.map(s => s.id))
    for (const [id, entry] of this.live) {
      if (persisted.has(id)) continue
      // A saved deletion is not proof that its previous namespace is unloaded.
      // Keep an explicit retry-only management entry until stop() actually finishes.
      servers.push({ ...entry.config, id, enabled: false, status: 'failed', cleanupPending: true,
        error: 'Saved deletion; cleanup pending. Retry removal.', toolCount: count(entry.handle), source: 'managed', writable: true })
    }
    let legacyAvailable = false
    try { await access(this.opts.legacyPath ?? join(homedir(), '.dsh', 'mcp.json')); legacyAvailable = true } catch { /* detection only */ }
    return { revision: doc.revision, servers: [...servers, ...native], legacyAvailable }
  }
  private async locked<T>(fn: () => Promise<T>): Promise<T> {
    await mkdir(resolve(this.opts.stateDir), { recursive: true, mode: 0o700 })
    const deadline = Date.now() + 5_000
    let handle
    while (!handle) {
      try { handle = await open(this.lock, 'wx', 0o600) } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'EEXIST') fail('WRITE_FAILED', 'Unable to lock MCP configuration')
        if (Date.now() >= deadline) fail('LOCKED', 'MCP configuration is locked; retry later')
        await delay(20)
      }
    }
    try { return await fn() } finally { await handle.close(); await unlink(this.lock) }
  }
  private async writeDocument(doc: Document): Promise<void> {
    const temp = `${this.target}.${randomUUID()}.tmp`
    let created = false
    try {
      const payload = JSON.stringify(doc, null, 2) + '\n'
      if (Buffer.byteLength(payload) > MAX_BYTES) fail('INVALID_INPUT', 'MCP configuration is too large')
      const h = await open(temp, 'wx', 0o600); created = true
      try { await h.writeFile(payload); await h.sync() } finally { await h.close() }
      // Atomic replacement of this profile's exact target, never a user-global file.
      await rename(temp, this.target); created = false
    } catch (e) {
      if (e instanceof McpManagerError) throw e
      fail('WRITE_FAILED', 'Unable to save MCP configuration')
    } finally { if (created) await unlink(temp).catch(() => {}) }
  }
  private mutate(revision: number, change: (doc: Document, native: McpServerSummary[]) => void | Promise<void>): Promise<void> {
    return this.serial(async () => {
      this.active()
      if (!Number.isSafeInteger(revision) || revision < 0) fail('CONFLICT', 'A current numeric revision is required')
      const doc = await this.locked(async () => {
        const current = await this.readDocument()
        if (current.revision !== revision) fail('CONFLICT', 'MCP configuration changed; refresh and retry')
        if (current.revision >= Number.MAX_SAFE_INTEGER) fail('INVALID_INPUT', 'MCP configuration limit reached')
        const native = await this.natives()
        await change(current, native)
        if (current.servers.length > 256) fail('INVALID_INPUT', 'MCP configuration limit reached')
        current.revision++
        await this.writeDocument(current)
        return current
      })
      await this.sync(doc.servers, await this.natives())
    })
  }
  save(input: McpServerConfig, revision: number): Promise<void> {
    // Snapshot before queueing: callers cannot mutate a pending write by alias.
    let server: McpServerConfig
    try { server = normalizeMcpServer(input) } catch (e) { return Promise.reject(e) }
    return this.mutate(revision, (doc, native) => {
      if (server.id !== undefined && native.some(s => s.id === server.id)) fail('READ_ONLY', 'Native MCP servers are read-only')
      if (native.some(s => s.name === server.name)) fail('CONFLICT', 'Choose a name distinct from native MCP servers')
      const index = server.id === undefined ? -1 : doc.servers.findIndex(s => s.id === server.id)
      if (server.id !== undefined && index < 0) fail('NOT_FOUND', 'Managed MCP server not found')
      if (doc.servers.some(s => s.name === server.name && s.id !== server.id)) fail('CONFLICT', 'MCP server name already exists')
      server = normalizeMcpServer({ ...server, id: server.id ?? randomUUID() })
      if (index < 0) doc.servers.push(server); else doc.servers[index] = server
    })
  }
  setEnabled(id: string, enabled: boolean, revision: number): Promise<void> {
    let nativeChanged = false
    return this.mutate(revision, async (doc, native) => {
      if (typeof enabled !== 'boolean') fail('INVALID_INPUT', 'enabled must be boolean')
      const external = native.find(s => s.id === id)
      if (external) {
        if (!external.toggleable || !this.opts.nativeSetEnabled) fail('READ_ONLY', 'Native MCP enablement is not manageable in this profile')
        try { await this.opts.nativeSetEnabled(id, enabled) }
        catch (error) {
          const code = error instanceof McpManagerError ? error.code : ''
          if (code === 'NATIVE_RESTART_REQUIRED') fail(code, 'Native MCP change was saved but requires restart; refresh before retrying')
          if (code === 'READ_ONLY' || code === 'NOT_FOUND') fail(code, 'Native MCP entry is unavailable or no longer manageable; refresh before retrying')
          fail('NATIVE_APPLY_FAILED', 'Native MCP change did not finish live; its saved state may have changed. Refresh before retrying')
        }
        nativeChanged = true
        return
      }
      const server = doc.servers.find(s => s.id === id)
      if (!server) fail('NOT_FOUND', 'Managed MCP server not found')
      if (enabled && native.some(s => s.name === server.name)) fail('CONFLICT', 'MCP server name conflicts with a native server')
      server.enabled = enabled
    }).catch(error => {
      if (nativeChanged) fail('NATIVE_STATE_CHANGED', 'Native MCP state was updated, but the manager revision or lifecycle could not be saved. Refresh before retrying')
      throw error
    })
  }
  delete(id: string, revision: number): Promise<void> {
    return this.mutate(revision, (doc, native) => {
      if (native.some(s => s.id === id)) fail('READ_ONLY', 'Native MCP servers are read-only')
      const index = doc.servers.findIndex(s => s.id === id)
      if (index < 0) {
        if (this.live.has(id)) return // Retry a saved deletion's still-pending cleanup.
        fail('NOT_FOUND', 'Managed MCP server not found')
      }
      doc.servers.splice(index, 1)
    })
  }
  reload(): Promise<void> {
    return this.serial(async () => { this.active(); await this.sync((await this.readDocument()).servers, await this.natives()) })
  }
  private async resolveRefs(server: McpServerConfig, controller: AbortController): Promise<{ env: Record<string, string>; headers: Record<string, string> }> {
    const env: Record<string, string> = {}, headers: Record<string, string> = {}
    controller.signal.throwIfAborted()
    for (const [mapping, target] of [[server.envRefs, env], [server.headerRefs, headers]] as const) {
      for (const [key, ref] of Object.entries(mapping ?? {})) {
        controller.signal.throwIfAborted()
        const value = await this.opts.resolveCredential(ref)
        controller.signal.throwIfAborted()
        if (typeof value !== 'string' || value.length > 65_536 || value.includes('\0') || (target === headers && /[\r\n]/.test(value))) throw new Error('credential unavailable')
        target[key] = value
      }
    }
    return { env, headers }
  }
  private async awaitCleanup(tasks: Promise<void>[]): Promise<void> {
    if (!tasks.length) return
    let timer: ReturnType<typeof setTimeout> | undefined
    try {
      await Promise.race([
        Promise.all(tasks),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('cleanup deadline')), CLEANUP_GRACE_MS) }),
      ])
    } catch { fail('DISPOSE_FAILED', 'MCP cleanup did not finish; no replacement was started') }
    finally { if (timer) clearTimeout(timer) }
  }
  private async connection(server: McpServerConfig, controller: AbortController, probe: boolean, track?: (cleanup: Promise<void>, adapterStarted: () => boolean) => void): Promise<McpHandle> {
    const signal = controller.signal
    let adapterStarted = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: () => void = () => {}
    let abandoned = false
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => { abandoned = true; reject(new Error('Connection cancelled')) }
      signal.addEventListener('abort', onAbort, { once: true })
      if (signal.aborted) onAbort()
      timer = setTimeout(() => controller.abort(), this.timeout)
    })
    const pending = (async () => {
      const resolved = await this.resolveRefs(server, controller)
      signal.throwIfAborted()
      adapterStarted = true
      const handle = await this.opts.connect(normalizeMcpServer(server), { ...resolved, signal }, probe)
      let disposal: Promise<void> | undefined
      return { toolCount: () => handle.toolCount(), dispose: () => disposal ??= Promise.resolve().then(() => handle.dispose()) }
    })()
    // Keep actual adapter settlement separate from the deadline race. A cooperative
    // adapter rejects only after its aborted scope has finished disposing.
    const cleanup = pending.then(async handle => { if (abandoned) await handle.dispose() }, () => {})
    this.pendingCleanup.add(cleanup)
    void cleanup.then(() => this.pendingCleanup.delete(cleanup), () => this.pendingCleanup.delete(cleanup))
    track?.(cleanup, () => adapterStarted)
    // Non-cooperative adapters remain tracked; late handles are still disposed.
    try { return await Promise.race([pending, cancelled]) }
    finally { if (timer) clearTimeout(timer); signal.removeEventListener('abort', onAbort) }
  }
  private async stop(id: string, entry: Live): Promise<void> {
    entry.controller.abort()
    await entry.task
    try { await this.awaitCleanup([entry.cleanup]) } catch (e) {
      entry.status = 'failed'
      entry.error = 'MCP cleanup pending or failed; replacement blocked'
      throw e
    }
    if (entry.handle) {
      try { await entry.handle.dispose() } catch {
        entry.status = 'failed'
        entry.error = 'MCP unload failed; replacement blocked'
        fail('DISPOSE_FAILED', 'Unable to unload MCP server; no replacement was started')
      }
      entry.handle = undefined
    }
    if (this.live.get(id) === entry) this.live.delete(id)
  }
  private async sync(servers: McpServerConfig[], native: McpServerSummary[]): Promise<void> {
    const desired = new Map(servers.filter(s => !this.disposed && s.enabled && !native.some(n => n.name === s.name || n.id === s.id)).map(s => [s.id!, s]))
    for (const [id, entry] of this.live) {
      const next = desired.get(id)
      if (!next || JSON.stringify(next) !== JSON.stringify(entry.config) || entry.status === 'failed') await this.stop(id, entry)
    }
    for (const [id, config] of desired) {
      if (this.live.has(id)) continue
      const entry: Live = { config, controller: new AbortController(), status: 'loading', task: Promise.resolve(), cleanup: Promise.resolve() }
      this.live.set(id, entry)
      entry.task = this.connection(config, entry.controller, false, cleanup => { entry.cleanup = cleanup }).then(async handle => {
        if (this.disposed || entry.controller.signal.aborted || this.live.get(id) !== entry) { await handle.dispose(); return }
        entry.handle = handle
        entry.status = 'loaded'
      }).catch(() => {
        if (!entry.controller.signal.aborted && this.live.get(id) === entry) { entry.status = 'failed'; entry.error = 'MCP connection failed (sensitive details hidden)' }
        else if (!this.disposed && this.live.get(id) === entry) { entry.status = 'failed'; entry.error = 'MCP connection cancelled or timed out' }
      })
    }
  }
  async testConnect(input: McpServerConfig, signal?: AbortSignal): Promise<{ ok: boolean; error?: string }> {
    this.active()
    let server: McpServerConfig
    try { server = normalizeMcpServer(input) } catch { return { ok: false, error: 'Invalid MCP server configuration' } }
    const controller = new AbortController()
    const aborted = () => controller.abort()
    signal?.addEventListener('abort', aborted, { once: true })
    if (signal?.aborted) controller.abort()
    this.probes.add(controller)
    const task = (async () => {
      let handle: McpHandle | undefined
      let cleanup = Promise.resolve()
      let adapterStarted = () => false
      try {
        handle = await this.connection(server, controller, true, (pending, started) => { cleanup = pending; adapterStarted = started })
        controller.signal.throwIfAborted()
        return { ok: true }
      }
      catch { return { ok: false, error: 'MCP connection failed or timed out (sensitive details hidden)' } }
      finally {
        controller.abort()
        if (handle) await handle.dispose()
        // A hung credential lookup owns no adapter scope and must not delay cancellation.
        // Once an adapter exists, give cooperative abort cleanup its bounded grace period.
        if (adapterStarted()) await this.awaitCleanup([cleanup])
      }
    })().catch(() => ({ ok: false, error: 'MCP probe cleanup failed (sensitive details hidden)' }))
    this.probeTasks.add(task)
    try { return await task } finally {
      signal?.removeEventListener('abort', aborted)
      this.probes.delete(controller)
      this.probeTasks.delete(task)
    }
  }
  dispose(): Promise<void> {
    // Abort immediately, even when a mutation is waiting for its previous handle to unload.
    this.disposed = true
    for (const probe of this.probes) probe.abort()
    for (const entry of this.live.values()) entry.controller.abort()
    return this.serial(async () => {
      await Promise.all([...this.probeTasks])
      const cleanup = this.awaitCleanup([...this.pendingCleanup]).then(() => true, () => false)
      const stopped = await Promise.all([...this.live].map(async ([id, entry]) => {
        try { await this.stop(id, entry); return true } catch { return false }
      }))
      if (!(await cleanup) || stopped.some(ok => !ok)) fail('DISPOSE_FAILED', 'Unable to unload every MCP server; cleanup remains tracked')
    })
  }
}
