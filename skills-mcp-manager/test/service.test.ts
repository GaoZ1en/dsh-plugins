import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm, access, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as plugin from '../src/index.ts'
import { parseRequest, safeError } from '../src/service.ts'
import { MANAGER_TOOL } from '../src/protocol.ts'

test('strict request boundary rejects unknown fields/actions and conceals arbitrary errors', () => {
  for (const input of [null, [], { action: 'sudo' }, { action: 'skills.trash', path: '/tmp/arbitrary' }, { action: 'skills.list', cwd: 42 }]) assert.throws(() => parseRequest(input))
  assert.deepEqual(safeError(new Error('secret-would-be-here')), { code: 'OPERATION_FAILED', message: 'Operation failed; no changes are implied. Refresh the list and check the configuration.' })
  assert.equal(safeError(Object.assign(new Error('sdk-secret'), { code: 'ECONNREFUSED' })).code, 'OPERATION_FAILED')
  assert.ok(!JSON.stringify(safeError(Object.assign(new Error('sdk-secret'), { code: 'EIO' }))).includes('sdk-secret'))
})

test('UI and agent share one service; mutation approval fails closed and lifecycle unregisters', { timeout: 10000 }, async () => {
  const dir = await realpath(await mkdtemp(join(tmpdir(), 'koishi-manager-service-')))
  const stateDir = join(dir, 'state')
  const ctx = new Context()
  const routes = new Set<unknown>()
  let outcome = 'rejected'
  let asks = 0
  new SystemPrompt(ctx, { includeHarnessIdentity: false })
  new ToolRuntime(ctx)
  new SkillRegistry(ctx)
  ctx.provide('agents', { list: () => [] } as never)
  ctx.provide('workingDirectory', { ensure: async () => dir } as never)
  ctx.provide('pluginManager', { listPlugins: async () => [], setPluginEnabled: async () => ({ application: 'applied' }) } as never)
  ctx.provide('webServer', { register: (route: unknown) => { routes.add(route); return () => { routes.delete(route) } } } as never)
  ctx.provide('connection', { requestRejection: () => undefined } as never)
  ctx.provide('credentials', { resolve: async () => undefined } as never)
  ctx.provide('approval', { request: async () => { asks++; return outcome } } as never)
  ctx.provide('workspaceRegistry', { list: () => [] } as never)
  ctx.provide('configEditor', { entries: () => [] } as never)
  const fiber = ctx.plugin(plugin, { stateDir })
  try {
    await fiber
    assert.equal(routes.size, 1)
    await assert.rejects(access(stateDir), 'startup reads must not create state')
    const call = (args: unknown) => ctx.tools.execute({ callId: 'fixture-manager-call' as never, name: MANAGER_TOOL, arguments: args, agent: { id: 'fixture-agent' } as never, signal: new AbortController().signal })
    const initial = await call({ action: 'mcp.list' })
    assert.equal(initial.isError, false)
    assert.deepEqual(initial.value, await ctx.koishiSkillsMcpManager.execute({ action: 'mcp.list' }))
    const save = { action: 'mcp.save', revision: 0, server: { name: 'disabled_fixture', transport: 'stdio', command: process.execPath, enabled: false } }
    assert.equal((await call(save)).isError, true)
    assert.equal(asks, 1)
    assert.equal((await ctx.koishiSkillsMcpManager.execute({ action: 'mcp.list' }) as { revision: number }).revision, 0)
    outcome = 'allowed-once' // Test-only answerer; never changes the real session policy.
    assert.equal((await call(save)).isError, false)
    const toolList = await call({ action: 'mcp.list' })
    assert.deepEqual(toolList.value, await ctx.koishiSkillsMcpManager.execute({ action: 'mcp.list' }))
    assert.equal((toolList.value as { revision: number }).revision, 1)
    assert.equal(asks, 2, 'reads do not prompt')
    assert.equal((await call({ action: 'mcp.save', revision: 0, server: save.server })).isError, true, 'stale revision fails for agent as for UI')
    await assert.rejects(ctx.koishiSkillsMcpManager.execute({ action: 'mcp.save', revision: 0, server: save.server }), /changed/)
    const service = ctx.koishiSkillsMcpManager
    const execute = service.execute.bind(service)
    let forwardedActor: string | undefined
    service.execute = async (_input, _signal, caller, actorCwd) => { assert.equal(caller, 'agent'); forwardedActor = actorCwd; return null }
    try {
      assert.equal((await call({ action: 'skills.read', id: 'fixture', cwd: '/untrusted-argument' })).isError, false)
      assert.equal(forwardedActor, dir, 'tool boundary supplies actual workingDirectory, not model-provided cwd')
    } finally { service.execute = execute }
    await fiber.dispose()
    assert.equal(ctx.tools.get(MANAGER_TOOL), undefined)
    assert.equal(routes.size, 0)
  } finally {
    await fiber.dispose()
    await ctx.fiber.dispose()
    assert.ok(dir.startsWith(join(await realpath(tmpdir()), 'koishi-manager-service-')))
    await rm(dir, { recursive: true, force: true })
  }
})
