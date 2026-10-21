import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as mcpClient from '@deepseek-ai/dsh-mcp-client'
import { SystemPrompt } from '@deepseek-ai/dsh-system-prompt'
import { listToggleableNativeIds, setNativeMcpEnabled, type NativeMcpContext } from '../src/native-mcp.ts'
import { McpManager } from '../src/mcp.ts'

type Manager = NonNullable<NativeMcpContext['pluginManager']>
type Entry = Awaited<ReturnType<Manager['listPlugins']>>[number]
type ChangeResult = Awaited<ReturnType<Manager['setPluginEnabled']>>
const entry = (extra: Partial<Entry> = {}): Entry => ({ entryId: 'include:fixture' as never, moduleName: '@deepseek-ai/dsh-mcp-client', patchId: 'fixture', enabled: true, fiberPhase: 'active', ...extra } as Entry)
function fake(entries: Entry[] = [entry()]) {
  const calls: Array<[string, boolean]> = []
  let application: ChangeResult['application'] = 'applied'
  let thrown = false
  const ctx: NativeMcpContext = { pluginManager: {
    listPlugins: async () => entries,
    setPluginEnabled: async (id, enabled) => {
      calls.push([id, enabled])
      if (thrown) throw new Error('sensitive plugin manager failure')
      return { changed: true, application, stage: 'enable', target: id, enabled }
    },
  } }
  return { ctx, calls, setApplication: (next: ChangeResult['application']) => { application = next }, setThrown: () => { thrown = true } }
}

test('native capabilities use exact public entry identity and exclude non-MCP/read-only rows', async () => {
  const entries = [entry(), entry({ entryId: 'other:addressable' as never, patchId: 'other' }),
    entry({ entryId: 'include:non-mcp' as never, moduleName: '@deepseek-ai/dsh-tools' }),
    { entryId: 'include:locked', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', readOnlyReason: 'management-required' } as Entry]
  const { ctx, calls } = fake(entries)
  assert.deepEqual(await listToggleableNativeIds(ctx), new Set(['native:include:fixture', 'native:other:addressable']))
  assert.deepEqual(await listToggleableNativeIds({}), new Set())
  await setNativeMcpEnabled(ctx, 'native:include:fixture', false)
  await setNativeMcpEnabled(ctx, 'native:other:addressable', true)
  assert.deepEqual(calls, [['include:fixture', false], ['other:addressable', true]])
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:locked', false), { code: 'READ_ONLY' })
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:non-mcp', false), { code: 'NOT_FOUND' })
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:missing', false), { code: 'NOT_FOUND' })
  await assert.rejects(setNativeMcpEnabled(ctx, 'fixture', false), { code: 'INVALID_INPUT' })
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:', false), { code: 'INVALID_INPUT' })
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:fixture', 'false' as never), { code: 'INVALID_INPUT' })
  assert.equal(calls.length, 2)
})

test('native capability and identity are revalidated immediately before each public change', async () => {
  const entries = [entry()]
  const { ctx, calls } = fake(entries)
  assert.equal((await listToggleableNativeIds(ctx)).size, 1)
  entries[0] = { entryId: 'include:fixture', moduleName: '@deepseek-ai/dsh-mcp-client', enabled: true, fiberPhase: 'active', readOnlyReason: 'unaddressable' } as Entry
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:fixture', false), { code: 'READ_ONLY' })
  assert.equal(calls.length, 0)
})

test('native adapter only reports applied changes as success and never forwards secret diagnostics', async () => {
  const { ctx, setApplication, setThrown } = fake()
  setApplication('restart-required')
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:fixture', false), { code: 'NATIVE_RESTART_REQUIRED' })
  for (const application of ['failed', 'overridden', 'cancelled'] as const) {
    setApplication(application)
    await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:fixture', false), error => {
      assert.equal((error as { code: string }).code, 'NATIVE_APPLY_FAILED')
      assert.match(String(error), /saved state may have changed.*Refresh/)
      return true
    })
  }
  setApplication('applied')
  setThrown()
  await assert.rejects(setNativeMcpEnabled(ctx, 'native:include:fixture', false), error => {
    assert.equal((error as { code: string }).code, 'NATIVE_APPLY_FAILED')
    assert.equal(String(error).includes('sensitive plugin'), false)
    return true
  })
  const unavailable: NativeMcpContext = { pluginManager: { listPlugins: async () => { throw new Error('secret inventory') }, setPluginEnabled: async () => { throw new Error('must not call') } } }
  await assert.rejects(listToggleableNativeIds(unavailable), { code: 'NATIVE_UNAVAILABLE' })
  await assert.rejects(setNativeMcpEnabled(unavailable, 'native:include:fixture', false), error => {
    assert.equal(String(error).includes('secret inventory'), false)
    return true
  })
})

// Isolated Context + real official MCP client + disposable stdio fixture. The fake
// plugin manager performs the lifecycle locally; it never reads a real profile.
test('native disable unloads actual SDK tools/instructions; re-enable restores both without changing config', { timeout: 25_000 }, async () => {
  const dir = await mkdtemp(join(tmpdir(), 'koishi-native-mcp-test-'))
  const ctx = new Context()
  new SystemPrompt(ctx, { includeHarnessIdentity: false })
  new ToolRuntime(ctx)
  const instructions = async () => (await ctx.systemPrompt.assemble()).sections.filter(section => section.name === 'mcp:native_fixture')
  const trace = join(dir, 'trace.jsonl')
  const config: mcpClient.Config = {
    serverName: 'native_fixture', transport: 'stdio', command: process.execPath,
    args: [fileURLToPath(new URL('./fixtures/mcp-stub.mjs', import.meta.url)), trace],
    env: { NATIVE_FIXTURE: 'original-value' }, cwd: dir,
    failOnStartupError: true, toolCallTimeoutMs: 60_000, reconnect: { enabled: false, initialDelayMs: 500, maxDelayMs: 30000, maxAttempts: 1 },
  }
  const original = JSON.stringify(config)
  const native = entry({ enabled: false, fiberPhase: null })
  let fiber: ReturnType<Context['plugin']> | undefined
  const calls: Array<[string, boolean]> = []
  const isolated: NativeMcpContext = { pluginManager: {
    listPlugins: async () => [native],
    setPluginEnabled: async (id, enabled) => {
      assert.equal(id, native.entryId)
      calls.push([id, enabled])
      if (enabled) {
        if (!fiber) { fiber = ctx.plugin(mcpClient, config); await fiber }
      } else {
        await fiber?.dispose()
        fiber = undefined
      }
      // The public change only completes after its real local fiber lifecycle.
      Object.assign(native, { enabled, fiberPhase: enabled ? 'active' : null })
      return { changed: true, application: 'applied', stage: 'enable', target: id, enabled }
    },
  } }
  const publicId = `native:${native.entryId}`
  const manager = new McpManager({
    stateDir: join(dir, 'manager-state'), legacyPath: join(dir, 'absent-legacy.json'),
    resolveCredential: async () => { throw new Error('Native config must not be resolved by this manager') },
    connect: async () => { throw new Error('Native config must not create a managed connection') },
    nativeServers: async () => [{ id: publicId, name: 'native_fixture', transport: 'stdio', enabled: native.enabled,
      status: 'external', source: 'native', writable: false, toggleable: (await listToggleableNativeIds(isolated)).has(publicId),
      toolCount: ctx.tools.schemas().filter(t => t.name.startsWith('mcp__native_fixture__')).length }],
    nativeSetEnabled: (id, enabled) => setNativeMcpEnabled(isolated, id, enabled),
  })
  try {
    await manager.setEnabled(publicId, true, 0)
    assert.ok(ctx.tools.get('mcp__native_fixture__ping'))
    assert.equal((await instructions()).length, 1, 'official server instructions are registered')
    assert.match((await instructions())[0].text, /Disposable test server; no user resources/)
    assert.equal((await instructions())[0].interpolate, false)
    const first = await ctx.tools.execute({ callId: 'native-first' as never, name: 'mcp__native_fixture__ping', arguments: { message: 'first' }, signal: new AbortController().signal })
    assert.equal(first.isError, false)
    assert.match(JSON.stringify(first.content), /pong:first/)
    await manager.setEnabled(publicId, false, 1)
    assert.equal(ctx.tools.get('mcp__native_fixture__ping'), undefined)
    assert.equal(ctx.tools.schemas().filter(t => t.name.startsWith('mcp__native_fixture__')).length, 0)
    assert.equal((await instructions()).length, 0, 'disable removes server instructions, not just UI status')
    assert.equal(native.enabled, false)
    await manager.setEnabled(publicId, true, 2)
    assert.ok(ctx.tools.get('mcp__native_fixture__ping'))
    assert.equal((await instructions()).length, 1)
    assert.match((await instructions())[0].text, /Disposable test server; no user resources/)
    const second = await ctx.tools.execute({ callId: 'native-second' as never, name: 'mcp__native_fixture__ping', arguments: { message: 'second' }, signal: new AbortController().signal })
    assert.equal(second.isError, false)
    assert.match(JSON.stringify(second.content), /pong:second/)
    assert.equal(JSON.stringify(config), original, 'native command/args/env/cwd remain untouched')
    assert.deepEqual(calls.map(([, enabled]) => enabled), [true, false, true])
    const traceRows = (await readFile(trace, 'utf8')).trim().split('\n').map(line => JSON.parse(line))
    // The SDK may spawn protocol-negotiation probes in addition to each real session.
    const actualCalls = traceRows.filter(row => row.method === 'tools/call')
    assert.equal(actualCalls.length, 2)
    assert.notEqual(actualCalls[0].pid, actualCalls[1].pid, 're-enable uses a fresh real server process')
    await manager.setEnabled(publicId, false, 3)
    assert.equal((await instructions()).length, 0)
    const stored = JSON.parse(await readFile(join(dir, 'manager-state', 'mcp.json'), 'utf8'))
    assert.deepEqual(stored, { schemaVersion: 1, revision: 4, servers: [] })
    const summary = (await manager.list()).servers[0]
    assert.equal(summary.writable, false)
    assert.equal(summary.toggleable, true)
    assert.equal(summary.enabled, false)
    assert.equal(summary.toolCount, 0)
  } finally {
    await manager.dispose()
    await fiber?.dispose()
    await ctx.fiber.dispose()
    assert.ok(dir.startsWith(join(tmpdir(), 'koishi-native-mcp-test-')))
    await rm(dir, { recursive: true, force: true })
  }
})
