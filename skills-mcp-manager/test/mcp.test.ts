import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { McpManager, McpManagerError, type McpHandle, type McpManagerOptions } from '../src/mcp.ts'
import type { McpServerConfig, McpServerSummary } from '../src/protocol.ts'

const config = (extra: Partial<McpServerConfig> = {}): McpServerConfig => ({ name: 'demo', transport: 'stdio', command: 'fake-mcp', enabled: false, ...extra })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
function handle() {
  let disposed = 0
  return { dispose: async () => { disposed++ }, toolCount: () => 3, get disposed() { return disposed } }
}
async function fixture(t: test.TestContext, options: Partial<McpManagerOptions> = {}) {
  const dir = await mkdtemp(join(tmpdir(), 'mcp-manager-test-'))
  const stateDir = join(dir, 'profile')
  const manager = new McpManager({ stateDir, legacyPath: join(dir, 'legacy.json'), nativeServers: async () => [], resolveCredential: async () => undefined, connect: async () => handle(), ...options })
  t.after(async () => {
    await manager.dispose()
    // dir is the exact mkdtemp-owned path, never a profile/user configuration path.
    assert.equal(dir.startsWith(join(tmpdir(), 'mcp-manager-test-')), true)
    await rm(dir, { recursive: true, force: true })
  })
  return { dir, stateDir, manager }
}
async function tick() { await new Promise<void>(resolve => setImmediate(resolve)) }
async function loaded(manager: McpManager) {
  for (let i = 0; i < 30; i++) {
    const list = await manager.list()
    if (list.servers[0]?.status !== 'loading') return list
    await tick()
  }
  throw new Error('Connection state did not settle')
}

test('read-only list creates nothing; legacy detection never loads old configuration', async t => {
  let connects = 0
  const { manager, dir, stateDir } = await fixture(t, { connect: async () => { connects++; return handle() } })
  assert.deepEqual(await manager.list(), { revision: 0, servers: [], legacyAvailable: false })
  await assert.rejects(stat(stateDir), { code: 'ENOENT' })
  await writeFile(join(dir, 'legacy.json'), JSON.stringify({ servers: [{ name: 'old', enabled: true, env: { SECRET: 'raw' } }] }))
  await manager.reload()
  assert.equal((await manager.list()).legacyAvailable, true)
  assert.equal(connects, 0)
  await assert.rejects(stat(stateDir), { code: 'ENOENT' })
})

test('CRUD uses stable IDs, revision checks and atomic 0600 profile storage', async t => {
  const { manager, stateDir } = await fixture(t)
  await manager.save(config(), 0)
  const first = await manager.list()
  assert.equal(first.revision, 1)
  const id = first.servers[0].id
  assert.ok(id)
  await manager.save(config({ id, name: 'renamed', args: ['--flag', 'a b'] }), 1)
  const second = await manager.list()
  assert.equal(second.servers[0].id, id)
  assert.equal(second.servers[0].name, 'renamed')
  await assert.rejects(manager.delete(id, 1), { code: 'CONFLICT' })
  await manager.setEnabled(id, true, 2)
  assert.equal((await loaded(manager)).servers[0].status, 'loaded')
  await manager.delete(id, 3)
  assert.deepEqual((await manager.list()).servers, [])
  const persisted = JSON.parse(await readFile(join(stateDir, 'mcp.json'), 'utf8'))
  assert.deepEqual(persisted, { schemaVersion: 1, revision: 4, servers: [] })
  assert.equal((await stat(join(stateDir, 'mcp.json'))).mode & 0o777, 0o600)
  assert.deepEqual(await readdir(stateDir), ['mcp.json'])
})

test('same-process and separate-manager concurrent writes cannot lose revisions', async t => {
  const { manager, stateDir, dir } = await fixture(t)
  const other = new McpManager({ stateDir, legacyPath: join(dir, 'missing'), nativeServers: async () => [], resolveCredential: async () => undefined, connect: async () => handle() })
  t.after(() => other.dispose())
  const result = await Promise.allSettled([manager.save(config(), 0), other.save(config({ name: 'second' }), 0), manager.save(config({ name: 'third' }), 0)])
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1)
  for (const r of result) if (r.status === 'rejected') assert.equal(r.reason.code, 'CONFLICT')
  assert.equal((await other.list()).servers.length, 1)
})

test('profiles remain isolated and reload neither duplicates nor auto-enables servers', async t => {
  let connects = 0
  const { manager, dir } = await fixture(t, { connect: async () => { connects++; return handle() } })
  const other = new McpManager({ stateDir: join(dir, 'other-profile'), legacyPath: join(dir, 'absent'), nativeServers: async () => [], resolveCredential: async () => undefined, connect: async () => { throw new Error('Must not connect') } })
  t.after(() => other.dispose())
  await manager.save(config({ enabled: true }), 0)
  await loaded(manager)
  await manager.reload()
  await loaded(manager)
  assert.equal(connects, 1)
  assert.deepEqual(await other.list(), { revision: 0, servers: [], legacyAvailable: false })
  await assert.rejects(stat(join(dir, 'other-profile')), { code: 'ENOENT' })
})

test('corrupt, old/raw and unsupported documents are never silently overwritten', async t => {
  const { manager, stateDir } = await fixture(t)
  await mkdir(stateDir)
  const invalid = ['{bad', '', JSON.stringify({ servers: [] }), JSON.stringify({ schemaVersion: 2, revision: 0, servers: [] }), JSON.stringify({ schemaVersion: 1, revision: 0, servers: [config({ id: 'x', env: { SECRET: 'do-not-leak' } } as never)] })]
  for (const raw of invalid) {
    await writeFile(join(stateDir, 'mcp.json'), raw)
    await assert.rejects(manager.list(), { code: 'CORRUPT_CONFIG' })
    await assert.rejects(manager.save(config(), 0), { code: 'CORRUPT_CONFIG' })
    assert.equal(await readFile(join(stateDir, 'mcp.json'), 'utf8'), raw)
  }
})

test('strict validation rejects raw secrets, prototype keys and invalid transport fields', async t => {
  const { manager } = await fixture(t)
  const invalid: unknown[] = [
    { ...config(), env: { TOKEN: 'secret' } }, { ...config(), headers: { Authorization: 'secret' } },
    { ...config(), enabled: 'true' }, { ...config(), command: 'evil\0command' }, { ...config(), args: [true] }, { ...config(), args: new Array(2) },
    { ...config(), cwd: 'relative/path' }, { ...config(), extra: true },
    JSON.parse('{"name":"demo","enabled":false,"transport":"stdio","command":"fake","envRefs":{"__proto__":"TOKEN"}}'),
    JSON.parse('{"name":"demo","enabled":false,"transport":"stdio","command":"fake","constructor":{}}'),
    config({ name: '__proto__' }), config({ name: 'a'.repeat(33) }), config({ envRefs: { TOKEN: 'raw secret token' } }),
    { name: 'http', enabled: false, transport: 'streamable-http', url: 'file:///tmp/socket' },
    { name: 'http', enabled: false, transport: 'streamable-http', url: 'https://user:secret@example.com/' },
    { name: 'http', enabled: false, transport: 'streamable-http', url: 'https://example.com/', headerRefs: { X: 'TOKEN', x: 'TOKEN' } },
  ]
  for (const input of invalid) await assert.rejects(manager.save(input as McpServerConfig, 0), { code: 'INVALID_INPUT' })
  assert.equal((await manager.list()).revision, 0)
  await manager.save(config({ name: 'a'.repeat(32) }), 0)
  assert.equal((await manager.list()).servers[0].name.length, 32)
})

test('native inventory is dynamic, read-only and name-conflict protected', async t => {
  let native: McpServerSummary[] = []
  const h = handle()
  const { manager } = await fixture(t, { nativeServers: async () => native, connect: async () => h })
  await manager.save(config({ enabled: true }), 0)
  await loaded(manager)
  native = [{ ...config(), id: 'native-demo', source: 'native', writable: true, status: 'loaded', toolCount: 4, error: 'native-secret', env: { SECRET: 'never-return' } } as McpServerSummary]
  const listing = await manager.list()
  assert.equal(listing.servers[1].writable, false)
  assert.equal(listing.servers[1].status, 'external')
  assert.equal(JSON.stringify(listing).includes('secret'), false)
  assert.equal(JSON.stringify(listing).includes('never-return'), false)
  await assert.rejects(manager.save(config(), 1), { code: 'CONFLICT' })
  await assert.rejects(manager.setEnabled('native-demo', false, 1), { code: 'READ_ONLY' })
  await assert.rejects(manager.delete('native-demo', 1), { code: 'READ_ONLY' })
  await assert.rejects(manager.save(config({ id: 'native-demo' }), 1), { code: 'READ_ONLY' })
  await manager.reload()
  assert.equal(h.disposed, 1)
})

test('native toggles use the public callback, preserve read-only config and never copy native servers', async t => {
  let enabled = true
  let managedConnects = 0
  const changes: Array<[string, boolean]> = []
  const id = 'native:include:existing'
  const { manager, stateDir } = await fixture(t, {
    nativeServers: async () => [{ ...config(), id, enabled, status: 'external', source: 'native', writable: false, toggleable: true, toolCount: enabled ? 2 : 0 }],
    nativeSetEnabled: async (target, value) => { changes.push([target, value]); enabled = value },
    connect: async () => { managedConnects++; return handle() },
  })
  assert.equal((await manager.list()).servers[0].toggleable, true)
  assert.equal((await manager.list()).servers[0].writable, false)
  await manager.setEnabled(id, false, 0)
  assert.equal((await manager.list()).servers[0].enabled, false)
  assert.equal((await manager.list()).servers[0].toolCount, 0)
  await manager.setEnabled(id, true, 1)
  assert.deepEqual(changes, [[id, false], [id, true]])
  assert.equal(managedConnects, 0)
  assert.deepEqual(JSON.parse(await readFile(join(stateDir, 'mcp.json'), 'utf8')), { schemaVersion: 1, revision: 2, servers: [] })
  await assert.rejects(manager.delete(id, 2), { code: 'READ_ONLY' })
  // Native identities are not accepted as editable managed configurations.
  await assert.rejects(manager.save(config({ id }), 2), { code: 'INVALID_INPUT' })
})

test('native toggles serialize under the profile revision lock and stale requests do not call the adapter', async t => {
  let calls = 0
  const id = 'native:include:existing'
  const nativeServers = async (): Promise<McpServerSummary[]> => [{ ...config(), id, status: 'external', source: 'native', writable: false, toggleable: true, toolCount: 0 }]
  const nativeSetEnabled = async () => { calls++; await tick() }
  const { manager, stateDir, dir } = await fixture(t, { nativeServers, nativeSetEnabled })
  const other = new McpManager({ stateDir, legacyPath: join(dir, 'absent'), nativeServers, nativeSetEnabled, resolveCredential: async () => undefined, connect: async () => handle() })
  t.after(() => other.dispose())
  const results = await Promise.allSettled([manager.setEnabled(id, true, 0), other.setEnabled(id, false, 0), manager.setEnabled(id, false, 0)])
  assert.equal(calls, 1)
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  for (const result of results) if (result.status === 'rejected') assert.equal(result.reason.code, 'CONFLICT')
  assert.equal((await manager.list()).revision, 1)
})

test('native toggleability requires both inventory capability and an adapter; configuration stays read-only', async t => {
  let toggleable = true
  const id = 'native:include:existing'
  const nativeServers = async (): Promise<McpServerSummary[]> => [{ ...config(), id, status: 'external', source: 'native', writable: false, toggleable, toolCount: 0 }]
  const { manager } = await fixture(t, { nativeServers })
  assert.equal((await manager.list()).servers[0].toggleable, false)
  await assert.rejects(manager.setEnabled(id, true, 0), { code: 'READ_ONLY' })
  let calls = 0
  toggleable = false
  const { manager: other } = await fixture(t, { nativeServers, nativeSetEnabled: async () => { calls++ } })
  await assert.rejects(other.setEnabled(id, true, 0), { code: 'READ_ONLY' })
  await assert.rejects(other.setEnabled(id, 'true' as never, 0), { code: 'INVALID_INPUT' })
  assert.equal(calls, 0)
})

test('native adapter failures redact diagnostics and distinguish saved-but-restart-required state', async t => {
  const id = 'native:include:existing'
  let restart = false
  const { manager } = await fixture(t, {
    nativeServers: async () => [{ ...config(), id, status: 'external', source: 'native', writable: false, toggleable: true, toolCount: 0 }],
    nativeSetEnabled: async () => { if (restart) throw new McpManagerError('NATIVE_RESTART_REQUIRED', 'secret diagnostic'); throw new Error('raw secret value') },
  })
  await assert.rejects(manager.setEnabled(id, false, 0), error => {
    assert.equal((error as McpManagerError).code, 'NATIVE_APPLY_FAILED')
    assert.equal(String(error).includes('raw secret'), false)
    return true
  })
  restart = true
  await assert.rejects(manager.setEnabled(id, false, 0), error => {
    assert.equal((error as McpManagerError).code, 'NATIVE_RESTART_REQUIRED')
    assert.match(String(error), /saved.*restart/)
    assert.equal(String(error).includes('secret diagnostic'), false)
    return true
  })
  assert.equal((await manager.list()).revision, 0)
})

test('revision save failure after native lifecycle change reports partial state truthfully', async t => {
  const id = 'native:include:existing'
  let enabled = true
  let path = ''
  const { manager, stateDir } = await fixture(t, {
    nativeServers: async () => [{ ...config(), id, enabled, status: 'external', source: 'native', writable: false, toggleable: true, toolCount: 0 }],
    nativeSetEnabled: async (_id, value) => { enabled = value; await mkdir(path) },
  })
  path = join(stateDir, 'mcp.json')
  await assert.rejects(manager.setEnabled(id, false, 0), error => {
    assert.equal((error as McpManagerError).code, 'NATIVE_STATE_CHANGED')
    assert.match(String(error), /updated.*Refresh/)
    return true
  })
  assert.equal(enabled, false)
  assert.equal((await stat(path)).isDirectory(), true)
})

test('credentials only resolve at connection time and neither persistence nor errors expose them', async t => {
  let resolves = 0
  let received: unknown
  const secret = 'super-secret-bearer-value'
  const { manager, stateDir } = await fixture(t, {
    resolveCredential: async ref => { resolves++; assert.equal(ref, 'vault/token'); return secret },
    connect: async (_config, resolved) => { received = resolved; throw new Error(`Failed with ${secret}`) },
  })
  await manager.save(config({ envRefs: { TOKEN: 'vault/token' } }), 0)
  await manager.list()
  assert.equal(resolves, 0)
  const id = (await manager.list()).servers[0].id
  await manager.setEnabled(id, true, 1)
  const listing = await loaded(manager)
  assert.equal(resolves, 1)
  assert.equal((received as { env: { TOKEN: string } }).env.TOKEN, secret)
  assert.equal(listing.servers[0].status, 'failed')
  assert.equal(JSON.stringify(listing).includes(secret), false)
  assert.equal((await readFile(join(stateDir, 'mcp.json'), 'utf8')).includes(secret), false)
  const probe = await manager.testConnect(config({ envRefs: { TOKEN: 'vault/token' } }))
  assert.equal(probe.ok, false)
  assert.equal(JSON.stringify(probe).includes(secret), false)
})

test('HTTP credential references are passed literally and HTTP(S) validated', async t => {
  let headers: Record<string, string> | undefined
  const { manager } = await fixture(t, { resolveCredential: async () => 'Bearer abc', connect: async (_c, resolved) => { headers = resolved.headers; return handle() } })
  assert.deepEqual(await manager.testConnect({ name: 'http', enabled: false, transport: 'streamable-http', url: 'http://localhost:8080/mcp', headerRefs: { Authorization: 'AUTH_TOKEN' } }), { ok: true })
  assert.deepEqual(headers, { Authorization: 'Bearer abc' })
})

test('loaded reflects schema registration only; disabled unload awaits old handle', async t => {
  const gate = deferred<void>()
  const unloading = deferred<void>()
  const old: McpHandle = { toolCount: () => 7, dispose: async () => { unloading.resolve(); await gate.promise } }
  const { manager } = await fixture(t, { connect: async () => old })
  await manager.save(config({ enabled: true }), 0)
  const listing = await loaded(manager)
  assert.equal(listing.servers[0].status, 'loaded')
  assert.equal(listing.servers[0].toolCount, 7)
  let finished = false
  const disable = manager.setEnabled(listing.servers[0].id, false, 1).then(() => { finished = true })
  await unloading.promise
  assert.equal(finished, false)
  gate.resolve()
  await disable
  assert.equal((await manager.list()).servers[0].status, 'stopped')
  assert.equal((await manager.list()).servers[0].toolCount, 0)
})

test('changing a config waits for old disposal before connecting replacement', async t => {
  const gate = deferred<void>()
  const unloading = deferred<void>()
  let connects = 0
  const { manager } = await fixture(t, { connect: async () => {
    connects++
    return connects === 1 ? { toolCount: () => 1, dispose: async () => { unloading.resolve(); await gate.promise } } : handle()
  } })
  await manager.save(config({ enabled: true }), 0)
  const listing = await loaded(manager)
  const update = manager.save(config({ id: listing.servers[0].id, enabled: true, args: ['changed'] }), 1)
  await unloading.promise
  assert.equal(connects, 1)
  gate.resolve()
  await update
  await loaded(manager)
  assert.equal(connects, 2)
})

test('retest of an already loaded name performs a fresh probe and disposes probe only', async t => {
  const handles: ReturnType<typeof handle>[] = []
  const modes: boolean[] = []
  const { manager } = await fixture(t, { connect: async (_c, _r, probe) => { const h = handle(); handles.push(h); modes.push(probe); return h } })
  await manager.save(config({ enabled: true }), 0)
  await loaded(manager)
  assert.deepEqual(await manager.testConnect(config()), { ok: true })
  assert.deepEqual(await manager.testConnect(config()), { ok: true })
  assert.deepEqual(modes, [false, true, true])
  assert.deepEqual(handles.map(h => h.disposed), [0, 1, 1])
  await manager.dispose()
  assert.equal(handles[0].disposed, 1)
})

test('deadline aborts connection and a non-cooperative late handle is cleaned', async t => {
  const pending = deferred<McpHandle>()
  let signal: AbortSignal | undefined
  const { manager } = await fixture(t, { connectTimeoutMs: 10, connect: async (_c, resolved) => { signal = resolved.signal; return pending.promise } })
  const probe = await manager.testConnect(config())
  assert.equal(probe.ok, false)
  assert.equal(signal?.aborted, true)
  const h = handle()
  pending.resolve(h)
  await tick()
  assert.equal(h.disposed, 1)
})

test('caller abort during a hung credential lookup returns promptly and can never start connect later', { timeout: 2_000 }, async t => {
  const lookup = deferred<string>()
  const started = deferred<void>()
  let resolves = 0
  let connects = 0
  const { manager } = await fixture(t, {
    resolveCredential: async () => { resolves++; started.resolve(); return lookup.promise },
    connect: async () => { connects++; return handle() },
  })
  const caller = new AbortController()
  const probe = manager.testConnect(config({ envRefs: { TOKEN: 'TOKEN', OTHER: 'OTHER' } }), caller.signal)
  await started.promise
  caller.abort(new Error('secret caller abort reason'))
  const result = await probe
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes('secret caller'), false)
  assert.equal(connects, 0)
  lookup.resolve('secret credential')
  await tick()
  assert.equal(resolves, 1)
  assert.equal(connects, 0)
})

test('already aborted caller signal never resolves credentials or starts an adapter', async t => {
  let resolves = 0
  let connects = 0
  const { manager } = await fixture(t, {
    resolveCredential: async () => { resolves++; return 'secret' },
    connect: async () => { connects++; return handle() },
  })
  const caller = new AbortController()
  caller.abort()
  assert.equal((await manager.testConnect(config({ envRefs: { TOKEN: 'TOKEN' } }), caller.signal)).ok, false)
  assert.equal((await manager.testConnect(config(), caller.signal)).ok, false)
  assert.equal(resolves, 0)
  assert.equal(connects, 0)
})

test('caller abort forwards to an in-flight adapter and awaits bounded cooperative cleanup', async t => {
  const started = deferred<void>()
  const aborted = deferred<void>()
  const cleanup = deferred<void>()
  const { manager } = await fixture(t, { connect: async (_c, resolved) => {
    started.resolve()
    return new Promise<McpHandle>((_yes, no) => resolved.signal!.addEventListener('abort', async () => {
      aborted.resolve()
      await cleanup.promise
      no(new Error('sensitive adapter cancellation detail'))
    }, { once: true }))
  } })
  const caller = new AbortController()
  let finished = false
  const probe = manager.testConnect(config(), caller.signal).then(result => { finished = true; return result })
  await started.promise
  caller.abort()
  await aborted.promise
  await tick()
  assert.equal(finished, false)
  cleanup.resolve()
  const result = await probe
  assert.equal(result.ok, false)
  assert.equal(JSON.stringify(result).includes('sensitive adapter'), false)
})

test('disable during initial connection invalidates callbacks and cleans late handles', async t => {
  const pending = deferred<McpHandle>()
  const started = deferred<void>()
  const aborted = deferred<void>()
  let signal: AbortSignal | undefined
  const { manager } = await fixture(t, { connect: async (_c, resolved) => {
    signal = resolved.signal
    signal!.addEventListener('abort', () => aborted.resolve(), { once: true })
    started.resolve()
    return pending.promise
  } })
  await manager.save(config({ enabled: true }), 0)
  await started.promise
  const id = (await manager.list()).servers[0].id
  let finished = false
  const disable = manager.setEnabled(id, false, 1).then(() => { finished = true })
  await aborted.promise
  assert.equal(signal?.aborted, true)
  assert.equal(finished, false)
  const late = handle()
  pending.resolve(late)
  await disable
  assert.equal(late.disposed, 1)
  assert.equal((await manager.list()).servers[0].status, 'stopped')
})

test('replacement waits for aborted adapter scope cleanup, not merely its deadline race', async t => {
  const cleanup = deferred<void>()
  const aborted = deferred<void>()
  let connects = 0
  const { manager } = await fixture(t, { connect: async (_c, resolved) => {
    connects++
    if (connects > 1) return handle()
    return new Promise<McpHandle>((_yes, no) => resolved.signal!.addEventListener('abort', async () => {
      aborted.resolve()
      await cleanup.promise
      no(new Error('aborted after scope cleanup'))
    }, { once: true }))
  } })
  await manager.save(config({ enabled: true }), 0)
  await tick()
  const id = (await manager.list()).servers[0].id
  let finished = false
  const update = manager.save(config({ id, enabled: true, args: ['new'] }), 1).then(() => { finished = true })
  await aborted.promise
  await tick()
  assert.equal(finished, false)
  assert.equal(connects, 1)
  cleanup.resolve()
  await update
  assert.equal((await loaded(manager)).servers[0].status, 'loaded')
  assert.equal(connects, 2)
})

test('non-cooperative pending cleanup fails closed and prevents replacement until drained', async t => {
  const pending = deferred<McpHandle>()
  let connects = 0
  const { manager } = await fixture(t, { connect: async () => { connects++; return connects === 1 ? pending.promise : handle() } })
  await manager.save(config({ enabled: true }), 0)
  await tick()
  const id = (await manager.list()).servers[0].id
  await assert.rejects(manager.save(config({ id, enabled: true, args: ['new'] }), 1), { code: 'DISPOSE_FAILED' })
  const blocked = (await manager.list()).servers[0]
  assert.equal(blocked.status, 'failed')
  assert.match(blocked.error!, /cleanup/)
  assert.equal(connects, 1)
  const late = handle()
  pending.resolve(late)
  await tick()
  assert.equal(late.disposed, 1)
  await manager.reload()
  assert.equal((await loaded(manager)).servers[0].status, 'loaded')
  assert.equal(connects, 2)
})

test('saved deletion with pending cleanup remains visible and supports revision-checked removal retry', async t => {
  const pending = deferred<McpHandle>()
  const started = deferred<void>()
  const { manager, stateDir } = await fixture(t, { connect: async () => { started.resolve(); return pending.promise } })
  await manager.save(config({ enabled: true }), 0)
  await started.promise
  const id = (await manager.list()).servers[0].id
  await assert.rejects(manager.delete(id, 1), { code: 'DISPOSE_FAILED' })
  const listing = await manager.list()
  assert.equal(listing.revision, 2)
  assert.equal(listing.servers.length, 1)
  assert.equal(listing.servers[0].id, id)
  assert.equal(listing.servers[0].enabled, false)
  assert.equal(listing.servers[0].status, 'failed')
  assert.equal(listing.servers[0].cleanupPending, true)
  assert.match(listing.servers[0].error!, /Retry removal/)
  assert.deepEqual(JSON.parse(await readFile(join(stateDir, 'mcp.json'), 'utf8')).servers, [])
  await assert.rejects(manager.delete(id, 1), { code: 'CONFLICT' })
  await assert.rejects(manager.setEnabled(id, true, 2), { code: 'NOT_FOUND' })
  const late = handle()
  pending.resolve(late)
  await tick()
  assert.equal(late.disposed, 1)
  await manager.delete(id, 2)
  assert.deepEqual((await manager.list()).servers, [])
  assert.equal((await manager.list()).revision, 3)
  assert.deepEqual(JSON.parse(await readFile(join(stateDir, 'mcp.json'), 'utf8')).servers, [])
})

test('unload waits for cooperative pending scope cleanup', async t => {
  const cleanup = deferred<void>()
  const aborted = deferred<void>()
  const { manager } = await fixture(t, { connect: async (_c, resolved) => new Promise<McpHandle>((_yes, no) => resolved.signal!.addEventListener('abort', async () => {
    aborted.resolve()
    await cleanup.promise
    no(new Error('aborted after cleanup'))
  }, { once: true })) })
  await manager.save(config({ enabled: true }), 0)
  await tick()
  let finished = false
  const unload = manager.dispose().then(() => { finished = true })
  await aborted.promise
  await tick()
  assert.equal(finished, false)
  cleanup.resolve()
  await unload
  assert.equal(finished, true)
})

test('unload also drains an aborted probe scope beyond the probe deadline race', async t => {
  const cleanup = deferred<void>()
  const aborted = deferred<void>()
  const started = deferred<void>()
  const { manager } = await fixture(t, { connect: async (_c, resolved) => {
    started.resolve()
    return new Promise<McpHandle>((_yes, no) => resolved.signal!.addEventListener('abort', async () => {
      aborted.resolve()
      await cleanup.promise
      no(new Error('probe scope disposed'))
    }, { once: true }))
  } })
  let probeFinished = false
  const probe = manager.testConnect(config()).then(result => { probeFinished = true; return result })
  await started.promise
  let finished = false
  const unload = manager.dispose().then(() => { finished = true })
  await aborted.promise
  await tick()
  assert.equal(probeFinished, false)
  assert.equal(finished, false)
  cleanup.resolve()
  assert.equal((await probe).ok, false)
  await unload
  assert.equal(finished, true)
})

test('unload aborts probes and managed connections, and prevents future mutation/probes', async t => {
  const signals: AbortSignal[] = []
  const started = deferred<void>()
  const { manager } = await fixture(t, { connect: async (_c, resolved) => {
    signals.push(resolved.signal!)
    if (signals.length === 2) started.resolve()
    return new Promise<McpHandle>((_yes, no) => resolved.signal!.addEventListener('abort', () => no(new Error('secret-abort-error')), { once: true }))
  } })
  await manager.save(config({ enabled: true }), 0)
  const probe = manager.testConnect(config())
  await started.promise
  await manager.dispose()
  assert.equal((await probe).ok, false)
  assert.equal(signals.every(s => s.aborted), true)
  await assert.rejects(manager.save(config(), 1), { code: 'DISPOSED' })
  await assert.rejects(manager.testConnect(config()), { code: 'DISPOSED' })
})
