import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillsManager } from '../src/skills.ts'
import { SkillPolicyStore } from '../src/skill-policy.ts'
import { McpManager } from '../src/mcp.ts'
import { ManagerService } from '../src/service.ts'
import type { SkillSummary, SkillDetail } from '../src/protocol.ts'

const raw = (name: string, flags = '') => `---\nname: ${name}\ndescription: A test skill\n${flags}---\nOriginal instructions.\n`
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'koishi-service-policy-')))
  assert.ok(root.includes('koishi-service-policy-'))
  t.after(async () => { assert.ok(root.includes('koishi-service-policy-')); await fs.rm(root, { recursive: true, force: true }) })
  const dshHome = join(root, 'dsh'), agentsHome = join(root, 'agents'), workspace = join(root, 'workspace'), stateDir = join(root, 'state')
  await fs.mkdir(join(dshHome, 'skills'), { recursive: true }); await fs.mkdir(join(workspace, '.dsh/skills'), { recursive: true })
  const source = join(root, 'external.md'), alias = join(dshHome, 'skills/linked.md')
  await fs.writeFile(source, raw('linked')); await fs.symlink(source, alias)
  await fs.writeFile(join(dshHome, 'skills/ordinary.md'), raw('ordinary'))
  const skills = new SkillsManager({ stateDir: join(stateDir, 'skills'), dshHome, agentsHome, workspacePaths: () => [workspace] })
  const policy = new SkillPolicyStore({ stateDir }); await policy.load()
  const mcp = new McpManager({ stateDir, nativeServers: async () => [], resolveCredential: async () => undefined, connect: async () => { throw new Error('not used') } })
  const service = new ManagerService({ skills, policy, mcp, workspaces: () => [{ id: 'workspace', path: workspace, title: 'workspace' }] })
  const list = (cwd?: string) => service.execute({ action: 'skills.list', cwd }) as Promise<SkillSummary[]>
  return { root, dshHome, workspace, stateDir, source, alias, skills, policy, mcp, service, list }
}

test('service toggles DSH visibility for a source-readonly link without changing bytes or link', async t => {
  const f = await fixture(t)
  const before = (await f.list()).find(s => s.name === 'linked')!
  assert.equal(before.writable, false); assert.equal(before.toggleable, true); assert.equal(before.enabled, true)
  await f.service.execute({ action: 'skills.toggle', id: before.id, revision: before.revision, enabled: false })
  const after = (await f.list()).find(s => s.id === before.id)!
  assert.equal(after.enabled, false); assert.equal(after.sourceEnabled, true)
  assert.notEqual(after.revision, before.revision)
  assert.equal((await f.skills.listSkills()).find(s => s.id === before.id)!.enabled, true, 'raw source invocation was not changed')
  assert.equal(await fs.readFile(f.source, 'utf8'), raw('linked'))
  assert.equal(await fs.readlink(f.alias), f.source)
  await assert.rejects(f.service.execute({ action: 'skills.toggle', id: before.id, revision: before.revision, enabled: true }), /refresh/)
  await f.service.execute({ action: 'skills.toggle', id: after.id, revision: after.revision, enabled: true })
  assert.equal((await f.list()).find(s => s.id === before.id)!.enabled, true)
  await f.mcp.dispose()
})

test('disabled skill body remains previewable by UI but is not an agent loading bypass', async t => {
  const f = await fixture(t)
  const [skill] = await f.list()
  await f.service.execute({ action: 'skills.toggle', id: skill.id, revision: skill.revision, enabled: false })
  const preview = await f.service.execute({ action: 'skills.read', id: skill.id }) as SkillDetail
  assert.match(preview.content, /Original instructions/)
  await assert.rejects(f.service.execute({ action: 'skills.read', id: skill.id }, undefined, 'agent'), error => (error as { code: string }).code === 'POLICY_DISABLED')
  await f.mcp.dispose()
})

test('workspace visibility overrides profile defaults regardless of filesystem source group', async t => {
  const f = await fixture(t)
  let skill = (await f.list()).find(s => s.name === 'linked')!
  await f.service.execute({ action: 'skills.toggle', id: skill.id, revision: skill.revision, enabled: false })
  skill = (await f.list(f.workspace)).find(s => s.name === 'linked')!
  assert.equal(skill.enabled, false)
  await f.service.execute({ action: 'skills.toggle', id: skill.id, revision: skill.revision, enabled: true, cwd: f.workspace })
  assert.equal((await f.list(f.workspace)).find(s => s.name === 'linked')!.enabled, true)
  assert.equal((await f.list()).find(s => s.name === 'linked')!.enabled, false)
  await f.mcp.dispose()
})

test('agent body preview enforces trusted actor scope even when request cwd is omitted or forged', async t => {
  const f = await fixture(t)
  const skill = (await f.list(f.workspace)).find(s => s.name === 'linked')!
  await f.service.execute({ action: 'skills.toggle', id: skill.id, revision: skill.revision, enabled: false, cwd: f.workspace })
  for (const cwd of [undefined, '', f.workspace]) {
    await assert.rejects(f.service.execute({ action: 'skills.read', id: skill.id, cwd }, undefined, 'agent', f.workspace), error => (error as { code: string }).code === 'POLICY_DISABLED')
  }
  const preview = await f.service.execute({ action: 'skills.read', id: skill.id }) as SkillDetail
  assert.match(preview.content, /Original instructions/, 'UI preview remains available')
  const elsewhere = await f.service.execute({ action: 'skills.read', id: skill.id }, undefined, 'agent', f.root) as SkillDetail
  assert.match(elsewhere.content, /Original instructions/, 'another trusted actor scope is unaffected')
  await f.mcp.dispose()
})

test('a source-level invocation denial cannot be granted by DSH visibility enable', async t => {
  const f = await fixture(t)
  await fs.writeFile(f.source, raw('linked', 'disable-model-invocation: true\nuser-invocable: false\n'))
  const skill = (await f.list()).find(s => s.name === 'linked')!
  assert.equal(skill.sourceEnabled, false)
  await assert.rejects(f.service.execute({ action: 'skills.toggle', id: skill.id, revision: skill.revision, enabled: true }), error => (error as { code: string }).code === 'SOURCE_DISABLED')
  assert.equal(f.policy.snapshot().revision, 0)
  await f.mcp.dispose()
})

test('policy-wrapped revisions still allow legitimate source trash and reject source edits', async t => {
  const f = await fixture(t)
  let skill = (await f.list()).find(s => s.name === 'ordinary')!
  await fs.appendFile(skill.path, 'External edit.\n')
  await assert.rejects(f.service.execute({ action: 'skills.trash', id: skill.id, revision: skill.revision }), /refresh/)
  skill = (await f.list()).find(s => s.name === 'ordinary')!
  await f.service.execute({ action: 'skills.trash', id: skill.id, revision: skill.revision })
  assert.equal((await f.list()).some(s => s.name === 'ordinary'), false)
  assert.equal((await f.skills.listTrash()).length, 1)
  await f.mcp.dispose()
})
