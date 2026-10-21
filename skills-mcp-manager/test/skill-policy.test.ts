import test from 'node:test'
import assert from 'node:assert/strict'
import * as fs from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SkillPolicyStore } from '../src/skill-policy.ts'

const errorCode = (code: string) => (error: unknown) => (error as { code?: string }).code === code
async function fixture(t: { after(fn: () => Promise<void>): void }) {
  const root = await fs.realpath(await fs.mkdtemp(join(tmpdir(), 'skill-policy-')))
  t.after(() => fs.rm(root, { recursive: true, force: true }))
  const stateDir = join(root, 'state')
  const policy = new SkillPolicyStore({ stateDir })
  return { root, stateDir, policy, path: join(stateDir, 'skill-policy.json') }
}

test('policy load is read-only, defaults enabled, returns detached snapshots, and persists private state', async t => {
  const f = await fixture(t)
  assert.throws(() => f.policy.snapshot(), errorCode('CORRUPT_STATE'))
  await assert.rejects(f.policy.setEnabled('sample', false, 0), errorCode('CORRUPT_STATE'))
  await f.policy.load()
  assert.deepEqual(f.policy.snapshot(), { revision: 0, rules: [] })
  assert.equal(f.policy.isEnabled('sample'), true)
  await assert.rejects(fs.stat(f.stateDir), { code: 'ENOENT' })
  let changes = 0
  const off = f.policy.subscribe(() => { changes++ })
  await f.policy.setEnabled('sample', false, 0)
  assert.equal(changes, 1)
  assert.equal(f.policy.isEnabled('sample'), false)
  assert.equal((await fs.stat(f.path)).mode & 0o777, 0o600)
  assert.equal((await fs.stat(f.stateDir)).mode & 0o777, 0o700)
  const snapshot = f.policy.snapshot(); snapshot.rules[0].enabled = true; snapshot.rules.push({ name: 'forged', enabled: false })
  assert.equal(f.policy.isEnabled('sample'), false)
  assert.equal(f.policy.isEnabled('forged'), true)
  const fresh = new SkillPolicyStore({ stateDir: f.stateDir }); await fresh.load()
  assert.deepEqual(fresh.snapshot(), f.policy.snapshot())
  await f.policy.setEnabled('sample', false, 1)
  assert.equal(f.policy.snapshot().revision, 1)
  assert.equal(changes, 1, 'unchanged exact rule is a no-op')
  off(); await f.policy.setEnabled('sample', true, 1)
  assert.equal(changes, 1)
})

test('exact workspace rules override global policy without granting other workspaces', async t => {
  const f = await fixture(t); await f.policy.load()
  const workspace = join(f.root, 'workspace'); const other = join(f.root, 'other')
  await f.policy.setEnabled('sample', false, 0)
  await f.policy.setEnabled('sample', true, 1, workspace)
  assert.equal(f.policy.isEnabled('sample'), false)
  assert.equal(f.policy.isEnabled('sample', workspace), true)
  assert.equal(f.policy.isEnabled('sample', join(workspace, 'child')), false)
  assert.equal(f.policy.isEnabled('sample', other), false)
  await f.policy.setEnabled('local', false, 2, workspace)
  assert.equal(f.policy.isEnabled('local'), true)
  assert.equal(f.policy.isEnabled('local', workspace), false)
  assert.equal(f.policy.isEnabled('local', other), true)
})

test('CAS and serialized concurrent writers prevent lost updates; explicit refresh publishes the validated snapshot', async t => {
  const f = await fixture(t); await f.policy.load()
  const other = new SkillPolicyStore({ stateDir: f.stateDir }); await other.load()
  const results = await Promise.allSettled([f.policy.setEnabled('first', false, 0), other.setEnabled('second', false, 0)])
  assert.equal(results.filter(r => r.status === 'fulfilled').length, 1)
  assert.equal(results.filter(r => r.status === 'rejected').length, 1)
  const stale = f.policy.snapshot().revision === 0 ? f.policy : other
  let notifications = 0
  stale.subscribe(() => { notifications++ })
  await stale.load()
  assert.equal(stale.snapshot().revision, 1)
  assert.equal(notifications, 1)
  await stale.load(); assert.equal(notifications, 1)
  await stale.setEnabled('third', false, 1)
  assert.equal(stale.snapshot().revision, 2)
  assert.equal(notifications, 2)
  await assert.rejects(stale.setEnabled('stale', false, 1), errorCode('CONFLICT'))
  assert.equal(stale.isEnabled('stale'), true)
})

test('corrupt load keeps last-good memory, writes fail closed, and same-revision tampering is detected', async t => {
  const f = await fixture(t); await f.policy.load()
  await f.policy.setEnabled('sample', false, 0)
  let notifications = 0; f.policy.subscribe(() => { notifications++ })
  await fs.writeFile(f.path, '{corrupt')
  await assert.rejects(f.policy.load(), errorCode('CORRUPT_STATE'))
  await assert.rejects(f.policy.setEnabled('sample', true, 1), errorCode('CORRUPT_STATE'))
  assert.equal(f.policy.isEnabled('sample'), false)
  assert.equal(notifications, 0)
  const tampered = { schemaVersion: 1, revision: 1, rules: [{ name: 'sample', enabled: true }] }
  await fs.writeFile(f.path, JSON.stringify(tampered))
  await assert.rejects(f.policy.setEnabled('sample', true, 1), errorCode('CONFLICT'))
  assert.equal(f.policy.isEnabled('sample'), false)
  await f.policy.load()
  assert.equal(f.policy.isEnabled('sample'), true)
  assert.equal(notifications, 1)
  for (const value of [null, [], { schemaVersion: 9, revision: 1, rules: [] }, { schemaVersion: 1, revision: 1, rules: [{ name: 'Bad', enabled: false }] }, { schemaVersion: 1, revision: 1, rules: [{ name: 'ok', enabled: false }, { name: 'ok', enabled: true }] }]) {
    await fs.writeFile(f.path, JSON.stringify(value))
    await assert.rejects(f.policy.load(), errorCode('CORRUPT_STATE'))
    assert.equal(f.policy.isEnabled('sample'), true)
  }
})

test('a previously loaded policy that disappears cannot silently re-enable skills or be recreated', async t => {
  const f = await fixture(t); await f.policy.load()
  await f.policy.setEnabled('sample', false, 0)
  const raw = await fs.readFile(f.path, 'utf8')
  let notifications = 0; f.policy.subscribe(() => { notifications++ })
  await fs.unlink(f.path)
  await assert.rejects(f.policy.load(), errorCode('CORRUPT_STATE'))
  await assert.rejects(f.policy.setEnabled('sample', true, 1), errorCode('CORRUPT_STATE'))
  assert.equal(f.policy.isEnabled('sample'), false)
  assert.equal(f.policy.snapshot().revision, 1)
  assert.equal(notifications, 0)
  await assert.rejects(fs.stat(f.path), { code: 'ENOENT' })
  await fs.writeFile(f.path, raw, { mode: 0o600 })
  await f.policy.load()
  assert.equal(f.policy.isEnabled('sample'), false)
  assert.equal(notifications, 0)
})

test('symlink state paths and held cross-process locks cannot be used for writes', async t => {
  const f = await fixture(t); await f.policy.load()
  await fs.mkdir(f.stateDir)
  await fs.writeFile(join(f.stateDir, '.skill-policy.lock'), 'another process', { mode: 0o600 })
  await assert.rejects(f.policy.setEnabled('sample', false, 0), errorCode('BUSY'))
  assert.equal(f.policy.isEnabled('sample'), true)
  await fs.unlink(join(f.stateDir, '.skill-policy.lock'))
  const outside = join(f.root, 'outside.json')
  await fs.writeFile(outside, JSON.stringify({ schemaVersion: 1, revision: 0, rules: [] }))
  await fs.symlink(outside, f.path)
  await assert.rejects(f.policy.load(), errorCode('UNSAFE_STATE'))
  await assert.rejects(f.policy.setEnabled('sample', false, 0), errorCode('UNSAFE_STATE'))
  const parentLink = join(f.root, 'state-link'); await fs.symlink(f.stateDir, parentLink)
  await assert.rejects(new SkillPolicyStore({ stateDir: parentLink }).load(), errorCode('UNSAFE_STATE'))
  assert.equal(JSON.parse(await fs.readFile(outside, 'utf8')).revision, 0)
})

test('invalid inputs never write and failing observers cannot veto committed changes', async t => {
  const f = await fixture(t); await f.policy.load()
  for (const name of ['../escape', 'Bad', 'a_b', '']) await assert.rejects(f.policy.setEnabled(name, false, 0), errorCode('INVALID_INPUT'))
  await assert.rejects(f.policy.setEnabled('sample', false, -1), errorCode('INVALID_INPUT'))
  await assert.rejects(f.policy.setEnabled('sample', false, 0, '../relative'), errorCode('INVALID_INPUT'))
  await assert.rejects(fs.stat(f.stateDir), { code: 'ENOENT' })
  f.policy.subscribe(() => { throw new Error('bad observer') })
  let observed = false
  f.policy.subscribe(() => { observed = !f.policy.isEnabled('sample') })
  await f.policy.setEnabled('sample', false, 0)
  assert.equal(observed, true)
  assert.equal(f.policy.snapshot().revision, 1)
})
