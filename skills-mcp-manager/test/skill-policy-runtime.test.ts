import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import AgentRegistry, { agentEvents } from '@deepseek-ai/dsh-agent'
import type { Agent, PreStepDecision, SessionStartSource } from '@deepseek-ai/dsh-agent'
import SkillRegistry, { isModelInvocable, isUserInvocable } from '@deepseek-ai/dsh-skill'
import type { SkillDefinition } from '@deepseek-ai/dsh-skill'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import { createScope } from '@deepseek-ai/dsh-scope'
import { SkillPolicyStore } from '../src/skill-policy.ts'
import { mountSkillPolicy } from '../src/skill-policy-runtime.ts'

async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'skill-policy-runtime-')))
  const policy = new SkillPolicyStore({ stateDir: join(root, 'state') }); await policy.load()
  const rootCtx = new Context()
  new SystemPrompt(rootCtx, {})
  const skillFiber = rootCtx.plugin(SkillRegistry); await skillFiber
  new AgentRegistry(rootCtx)
  new ToolRuntime(rootCtx)
  const directories = new Map<Agent, string>()
  rootCtx.provide('workingDirectory', { ensure: async (agent: Agent) => directories.get(agent) ?? root } as never)
  // The registry is provided by a sibling plugin, not root itself, so un-injected Agent contexts cannot borrow access.
  let ctx!: Context
  const access = rootCtx.inject(['skills'], scoped => { ctx = scoped }); await access
  const toolFiber = rootCtx.plugin(toolSkill)
  await toolFiber
  const presetKey = {}; const standing = createScope(ctx, presetKey)
  const definition = (name: string, body: string, invocation = { modelInvocable: true, userInvocable: true }): SkillDefinition => ({ name, description: `SECRET DESCRIPTION ${name}`, content: body, source: 'runtime', provider: 'runtime', invocation })
  ctx.skills.register(definition('sample', 'GLOBAL BODY'))
  standing.ctx.skills.register(definition('sample', 'PRESET BODY'))
  standing.ctx.skills.register(definition('model-only', 'MODEL ONLY BODY', { modelInvocable: true, userInvocable: false }))
  standing.ctx.skills.register(definition('user-only', 'USER ONLY BODY', { modelInvocable: false, userInvocable: true }))
  let counter = 0
  const live: Array<{ agent: Agent; dispose(): Promise<void>; preStep(message?: string): Promise<PreStepDecision>; commit(decision: PreStepDecision): void }> = []
  async function makeAgent(cwd = root, source: SessionStartSource = 'startup') {
    const history: Array<{ type: string; seq: number; data: unknown }> = []
    const id = `fixture-${++counter}`
    const session = { id, get seq() { return history.length }, surface: { get nodes() { return history.map(event => event.seq) } }, eventAt(index: number) { return history[index] } }
    const object = { id, session }
    let scope!: ReturnType<typeof createScope>
    const owner = rootCtx.plugin({ name: 'restricted-agent-owner', inject: ['agents'], apply(narrow: Context) { scope = createScope(narrow, object, { parent: presetKey }) } }); await owner
    const agent = Object.assign(object, { ctx: scope.ctx }) as unknown as Agent
    directories.set(agent, cwd)
    const unregister = ctx.agents.enter(agent, undefined)
    await ctx.agents.announce(agent, source)
    const item = {
      agent,
      async dispose() { unregister(); directories.delete(agent); await owner.dispose() },
      async preStep(message?: string) {
        const messages = message === undefined ? [] : [{ id: `message-${counter}`, role: 'user', content: [{ type: 'text', text: message }], source: { kind: 'user' } }] as never
        return await agentEvents(ctx, agent).waterfall('agent/pre-step', { turn: 1, step: 1, messages, signal: new AbortController().signal }, async () => ({ kind: 'enter', messages }))
      },
      commit(decision: PreStepDecision) { if (decision.kind === 'enter') for (const message of decision.messages) history.push({ type: 'user/message', seq: history.length, data: message }) },
    }
    live.push(item)
    return item
  }
  const execute = (agent: Agent, name = 'sample') => ctx.tools.execute({ callId: `call-${counter}` as never, name: 'skill', arguments: { name }, agent, signal: new AbortController().signal })
  const mount = (options: { resolveCwd?: (cwd?: string) => string | undefined; mappingRevision?: () => string } = {}) => rootCtx.plugin({ name: 'policy-fixture', inject: ['agents'], async apply(owner: Context) { await mountSkillPolicy(owner, policy, options) } })
  t.after(async () => {
    for (const item of live) await item.dispose()
    await rootCtx.fiber.dispose()
    await fs.rm(root, { recursive: true, force: true })
  })
  return { root, get ctx() { return ctx }, policy, makeAgent, execute, mount, standing, presetKey, directories, skillFiber, toolFiber, access }
}
function sources(decision: PreStepDecision, kind: string) {
  return decision.kind === 'enter' ? decision.messages.filter(message => message.source.kind === kind) : []
}

test('restricted Agent contexts require declared skills injection; the bridge awaits current and future protection', async t => {
  const f = await fixture(t)
  const current = await f.makeAgent()
  assert.throws(() => current.agent.ctx.skills, /"skills" without inject/)
  await f.policy.setEnabled('sample', false, 0)
  const plugin = f.mount(); await plugin
  assert.equal((await f.execute(current.agent)).isError, true)
  assert.ok(!JSON.stringify(sources(await current.preStep(), 'skill-catalog')).includes('SECRET DESCRIPTION sample'))
  const future = await f.makeAgent()
  assert.throws(() => future.agent.ctx.skills, /"skills" without inject/)
  assert.equal((await f.execute(future.agent)).isError, true)
  assert.ok(!JSON.stringify(sources(await future.preStep(), 'skill-catalog')).includes('SECRET DESCRIPTION sample'))
  await plugin.dispose()
  assert.equal((await f.execute(current.agent)).isError, false)
})

test('nearest agent tombstones remove model catalog, deny real SDK loader/get and suppress user invocation', async t => {
  const f = await fixture(t)
  const current = await f.makeAgent()
  assert.equal((await f.execute(current.agent)).isError, false)
  const initial = await current.preStep('/sample')
  assert.equal(sources(initial, 'skill-invocation').length, 1)
  assert.equal(sources(initial, 'skill-catalog').length, 1)
  current.commit(initial)
  const plugin = f.mount(); await plugin
  await f.policy.setEnabled('sample', false, 0)
  const summary = (await f.ctx.skills.list({ scope: current.agent, cwd: f.root })).find(skill => skill.name === 'sample')!
  assert.deepEqual(summary.invocation, { modelInvocable: false, userInvocable: false })
  assert.equal(summary.description, 'Disabled in DSH')
  assert.equal(await f.ctx.skills.get('sample', { scope: current.agent, cwd: f.root }), undefined)
  const result = await f.execute(current.agent)
  assert.equal(result.isError, true)
  assert.ok(!JSON.stringify(result).includes('BODY'))
  const replacement = await current.preStep('/sample')
  assert.equal(sources(replacement, 'skill-invocation').length, 0)
  const catalogs = sources(replacement, 'skill-catalog')
  assert.equal(catalogs.length, 1)
  const source = catalogs[0].source as unknown as { update: boolean; entries: Array<{ name: string }> }
  assert.equal(source.update, true)
  assert.ok(!source.entries.some(entry => entry.name === 'sample'))
  assert.ok(!JSON.stringify(catalogs).includes('SECRET DESCRIPTION sample'))
  const fresh = await f.makeAgent()
  const freshCatalog = sources(await fresh.preStep(), 'skill-catalog')
  const beforeBytes = Buffer.byteLength(JSON.stringify(sources(initial, 'skill-catalog')))
  const afterBytes = Buffer.byteLength(JSON.stringify(freshCatalog))
  assert.ok(afterBytes < beforeBytes, 'a fresh conversation advertises a smaller catalog, not merely a disabled UI row')
  t.diagnostic(`First-turn skill catalog payload: ${beforeBytes} -> ${afterBytes} UTF-8 bytes; exact model token count not measured`)
  assert.equal((await f.ctx.skills.get('sample', { scope: f.presetKey, cwd: f.root }))!.content, 'PRESET BODY', 'cold/standing registry is intentionally not mutated')
})

test('future and resumed/clear/compacted Agents are masked before creation resolves and duplicate sources cannot grant', async t => {
  const f = await fixture(t)
  await f.policy.setEnabled('sample', false, 0)
  const plugin = f.mount(); await plugin
  for (const source of ['startup', 'resume', 'clear', 'compact'] as const) {
    const item = await f.makeAgent(f.root, source)
    const alternate = item.agent.ctx.inject(['skills'], scoped => scoped.skills.registerProvider(() => ({
      name: `alternate-${source}`,
      async list() { return [{ name: 'sample', description: 'BYPASS DESCRIPTION', source: 'custom', provider: `alternate-${source}`, rank: -12345, invocation: { modelInvocable: true, userInvocable: true }, locator: null }] },
      async get() { return { name: 'sample', description: 'BYPASS DESCRIPTION', content: 'BYPASS BODY', source: 'custom', provider: `alternate-${source}`, invocation: { modelInvocable: true, userInvocable: true } } },
    }))); await alternate
    assert.equal((await f.execute(item.agent)).isError, true)
    assert.equal(await f.ctx.skills.get('sample', { scope: item.agent, cwd: f.root }), undefined)
    const decision = await item.preStep('/sample')
    assert.equal(sources(decision, 'skill-invocation').length, 0)
    assert.ok(!JSON.stringify(sources(decision, 'skill-catalog')).includes('BYPASS DESCRIPTION'))
  }
})

test('workspace overrides stay deny-only and enabling restores original model/user strategy rather than granting it', async t => {
  const f = await fixture(t)
  const workspace = join(f.root, 'workspace'); const other = join(f.root, 'other')
  await f.policy.setEnabled('sample', false, 0)
  await f.policy.setEnabled('sample', true, 1, workspace)
  await f.policy.setEnabled('user-only', false, 2)
  const plugin = f.mount(); await plugin
  const allowed = await f.makeAgent(workspace); const denied = await f.makeAgent(other)
  assert.equal((await f.execute(allowed.agent)).isError, false)
  assert.equal((await f.execute(denied.agent)).isError, true)
  await f.policy.setEnabled('user-only', true, 3)
  assert.equal((await f.execute(allowed.agent, 'user-only')).isError, true, 'enable cannot grant model invocation to user-only skills')
  const skill = await f.ctx.skills.get('user-only', { scope: allowed.agent, cwd: workspace })
  assert.deepEqual(skill!.invocation, { modelInvocable: false, userInvocable: true })
  const decision = await allowed.preStep('/user-only /model-only')
  const invoked = sources(decision, 'skill-invocation')
  assert.equal(invoked.length, 1)
  assert.equal((invoked[0].source as unknown as { name: string }).name, 'user-only')
  assert.equal((await f.ctx.skills.list({ scope: allowed.agent, cwd: workspace })).filter(isModelInvocable).some(s => s.name === 'user-only'), false)
  assert.equal((await f.ctx.skills.list({ scope: allowed.agent, cwd: workspace })).filter(isUserInvocable).some(s => s.name === 'model-only'), false)
})

test('optional cwd resolver maps nested session directories to the selected workspace policy', async t => {
  const f = await fixture(t)
  const workspace = join(f.root, 'workspace')
  await f.policy.setEnabled('sample', false, 0, workspace)
  const resolveCwd = (cwd?: string) => cwd === workspace || cwd?.startsWith(`${workspace}/`) ? workspace : cwd
  const plugin = f.mount({ resolveCwd }); await plugin
  const nested = await f.makeAgent(join(workspace, 'plugin', 'nested'))
  const other = await f.makeAgent(join(f.root, 'unrelated'))
  assert.equal((await f.execute(nested.agent)).isError, true)
  assert.equal((await f.execute(other.agent)).isError, false)
  assert.equal(f.policy.isEnabled('sample', join(workspace, 'plugin', 'nested')), true, 'store exact-key semantics are unchanged')
})

test('workspace domain changes invalidate hot mappings without treating unrelated domain writes as workspace changes', async t => {
  const f = await fixture(t)
  const workspace = join(f.root, 'workspace'); const cwd = join(workspace, 'nested')
  let registered = false
  await f.policy.setEnabled('sample', false, 0, workspace)
  const plugin = f.mount({ resolveCwd: value => registered && value === cwd ? workspace : value, mappingRevision: () => JSON.stringify(registered ? [workspace] : []) }); await plugin
  const item = await f.makeAgent(cwd)
  assert.equal((await f.ctx.skills.get('sample', { scope: item.agent, cwd }))!.content, 'PRESET BODY')
  registered = true
  f.ctx.emit('domain/changed', { domain: 'unrelated', table: '', key: '', operation: 'put', value: {} })
  assert.equal((await f.ctx.skills.get('sample', { scope: item.agent, cwd }))!.content, 'PRESET BODY', 'unrelated domains do not invalidate the warm registry')
  f.ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'put', value: {} })
  assert.equal(await f.ctx.skills.get('sample', { scope: item.agent, cwd }), undefined)
  await plugin.dispose()
  registered = false
  let mappingChecks = 0
  const replacement = f.mount({ resolveCwd: value => registered && value === cwd ? workspace : value, mappingRevision: () => { mappingChecks++; return JSON.stringify(registered ? [workspace] : []) } }); await replacement
  await replacement.dispose()
  const before = mappingChecks
  f.ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'deleted' })
  await item.preStep(); await f.execute(item.agent)
  assert.equal(mappingChecks, before, 'all mapping-boundary listeners are removed on plugin disposal')
})

test('request boundaries close the early-domain-event projection race for both model catalog and loader', async t => {
  const f = await fixture(t)
  const workspace = join(f.root, 'workspace'); const cwd = join(workspace, 'nested')
  let registered = false
  await f.policy.setEnabled('sample', false, 0, workspace)
  const plugin = f.mount({ resolveCwd: value => registered && value === cwd ? workspace : value, mappingRevision: () => JSON.stringify(registered ? [workspace] : []) }); await plugin
  const item = await f.makeAgent(cwd)
  const initial = await item.preStep(); item.commit(initial)
  assert.ok(JSON.stringify(sources(initial, 'skill-catalog')).includes('SECRET DESCRIPTION sample'))
  // The storage event comes before the registry projection. An intervening read rewarms the old mapping.
  f.ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'put', value: {} })
  assert.equal((await f.ctx.skills.get('sample', { scope: item.agent, cwd }))!.content, 'PRESET BODY')
  registered = true // No further event: only the request-boundary revision check can retire this cache.
  const replacement = await item.preStep('/sample')
  assert.equal(sources(replacement, 'skill-invocation').length, 0)
  assert.ok(!JSON.stringify(sources(replacement, 'skill-catalog')).includes('SECRET DESCRIPTION sample'))
  assert.equal((await f.execute(item.agent)).isError, true)
  // Reproduce the same race without any pre-step, so tools/pre-execute must independently enforce it.
  registered = false
  await item.preStep() // Observe the mapping revision reverting to the unregistered state.
  f.ctx.emit('domain/changed', { domain: 'workspace', table: '', key: '', operation: 'put', value: {} })
  assert.equal((await f.ctx.skills.get('sample', { scope: item.agent, cwd }))!.content, 'PRESET BODY')
  registered = true
  const result = await f.execute(item.agent)
  assert.equal(result.isError, true)
  assert.ok(!JSON.stringify(result).includes('PRESET BODY'))
})

test('declared dependency fibers restore tombstones after skills-service reload without duplicate providers', async t => {
  const f = await fixture(t)
  const item = await f.makeAgent()
  assert.throws(() => item.agent.ctx.skills, /"skills" without inject/)
  await f.policy.setEnabled('sample', false, 0)
  const plugin = f.mount(); await plugin
  assert.equal((await f.execute(item.agent)).isError, true)
  await f.skillFiber.restart()
  await f.access; await f.toolFiber
  f.ctx.skills.register({ name: 'sample', description: 'Reloaded skill', content: 'RELOADED BODY', source: 'runtime' })
  assert.equal(await f.ctx.skills.get('sample', { scope: item.agent, cwd: f.root }), undefined)
  assert.equal((await f.execute(item.agent)).isError, true)
  await f.policy.setEnabled('sample', true, 1)
  const allowed = await f.execute(item.agent)
  assert.equal(allowed.isError, false)
  assert.equal((allowed.value as { content: string }).content, 'RELOADED BODY')
  await f.policy.setEnabled('sample', false, 2)
  assert.equal((await f.execute(item.agent)).isError, true)
  await plugin.dispose()
  assert.equal((await f.execute(item.agent)).isError, false)
  const replacement = f.mount(); await replacement
  assert.equal((await f.execute(item.agent)).isError, true)
  await replacement.dispose()
})

test('explicit refresh invalidates hot registry caches and either lifecycle owner removes only its providers', async t => {
  const f = await fixture(t)
  const one = await f.makeAgent(); const two = await f.makeAgent()
  const plugin = f.mount(); await plugin
  assert.equal((await f.execute(one.agent)).isError, false)
  const external = new SkillPolicyStore({ stateDir: join(f.root, 'state') }); await external.load()
  await external.setEnabled('sample', false, 0)
  assert.equal((await f.execute(one.agent)).isError, false, 'no watcher or implicit provider disk reads')
  await f.policy.load()
  assert.equal((await f.execute(one.agent)).isError, true)
  assert.equal((await f.execute(two.agent)).isError, true)
  await one.dispose()
  assert.equal((await f.ctx.skills.list({ scope: one.agent, cwd: f.root })).find(s => s.name === 'sample')!.provider, 'runtime')
  assert.equal((await f.execute(two.agent)).isError, true, 'disposing one Agent cannot release another Agent policy')
  await plugin.dispose()
  assert.equal((await f.execute(two.agent)).isError, false, 'plugin unload releases borrowed per-agent effects')
  const replacement = f.mount(); await replacement
  assert.equal((await f.execute(two.agent)).isError, true, 'remount leaves no duplicate provider registration')
  await replacement.dispose()
  assert.equal((await f.execute(two.agent)).isError, false)
})
