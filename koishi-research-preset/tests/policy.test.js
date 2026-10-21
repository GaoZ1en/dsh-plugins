import test from 'node:test';
import assert from 'node:assert/strict';
import { inheritedManagementTools, apply } from '../index.js';
import { createMathResultListener } from '../math-policy.js';

const exec = () => ({ name: 'mcp__sage__sage_run', callId: 'call1', arguments: { code: '2+2' }, agent: { id: 'session1' }, signal: new AbortController().signal });
const result = () => ({ isError: false, value: { content: [{ type: 'text', text: 'full payload' }], structuredContent: { mode: 'run', ok: true, result: '4', resultType: 'sage.rings.integer.Integer', truncated: false, error: null, stdout: '', stderr: '', warnings: [], stdoutTruncated: false, stderrTruncated: false } }, content: [{ type: 'text', text: 'full payload' }] });
const storage = () => {
  const saved = [];
  return { saved, async saveText(input) { saved.push(input); return { locator: `/private/file-${saved.length}`, bytes: Buffer.byteLength(input.content), retrievalHint: 'Use read with offset/limit, or grep this path to search within it.' }; } };
};

test('tool policy denies only known global management tools, not research/search tools', () => {
  const tools = { presentAs: mode => { assert.equal(mode, 'native'); }, schemas: () => ['skills_mcp_manager', 'session_search', 'mcp__sage__sage_run', 'working_directory', 'read', 'plugin_manager'].map(name => ({ name })), restrict: filter => { tools.filter = filter; } };
  assert.deepEqual(inheritedManagementTools(tools), ['plugin_manager', 'skills_mcp_manager']);
  apply({ tools }); assert.deepEqual(tools.filter, { deny: ['plugin_manager', 'skills_mcp_manager'] });
  assert.deepEqual(inheritedManagementTools({ schemas: () => [] }), []);
});
test('math projection saves server-returned evidence without changing canonical value or contexts', async () => {
  const store = storage(), e = exec(), r = result(); const before = structuredClone(r);
  const contexts = [{ role: 'user', content: [{ type: 'text', text: 'context' }] }];
  const decision = await createMathResultListener(store)(e, r, async () => ({ kind: 'accept', additionalContexts: contexts }));
  assert.equal(store.saved.length, 2); assert.equal(decision.kind, 'accept'); assert.equal(decision.additionalContexts, contexts);
  assert.ok(!Object.hasOwn(decision, 'value')); assert.deepEqual(r, before);
  const data = JSON.parse(store.saved[0].content);
  assert.equal(data.completeness, 'server-returned'); assert.deepEqual(data.received.value, r.value);
  assert.deepEqual(data.arguments, e.arguments); assert.equal(store.saved[0].owner.sessionId, 'session1');
  assert.match(decision.content[0].text, /4/); assert.match(decision.content[0].text, /\/private\/file-1/); assert.match(decision.content[0].text, /\/private\/file-2/);
});
test('the complete inline response, including both artifact paths, fits 4096 characters', async () => {
  const store = storage(), r = result(); r.value.structuredContent.result = '𝛼'.repeat(6000);
  const output = await createMathResultListener(store)(exec(), r, async () => ({ kind: 'accept' }));
  assert.ok(output.content[0].text.length <= 4096); assert.match(output.content[0].text, /display omitted/);
  assert.match(output.content[0].text, /\/private\/file-1/); assert.match(output.content[0].text, /\/private\/file-2/);
});

test('huge retrieval hints fail open to the original, never a pathless projection', async () => {
  const original = { kind: 'accept' };
  const store = { async saveText() { return { locator: '/some/file', retrievalHint: 'x'.repeat(5000) }; } };
  assert.equal(await createMathResultListener(store)(exec(), result(), async () => original), original);
});

test('blocked/value-replaced/redacted/errored/unknown/non-math outcomes pass through', async () => {
  const cases = [
    [exec(), result(), { kind: 'block', feedback: [{ type: 'text', text: 'blocked' }] }],
    [exec(), result(), { kind: 'accept', value: { replacement: true } }],
    [exec(), result(), { kind: 'accept', content: [{ type: 'text', text: 'redacted' }] }],
    [exec(), { isError: true, error: { message: 'failed' }, content: [] }, { kind: 'accept' }],
    [exec(), { ...result(), value: {} }, { kind: 'accept' }],
    [{ ...exec(), name: 'read' }, result(), { kind: 'accept' }],
    [{ ...exec(), agent: undefined }, result(), { kind: 'accept' }],
  ];
  for (const [e, r, next] of cases) {
    const store = storage(); assert.equal(await createMathResultListener(store)(e, r, async () => next), next); assert.equal(store.saved.length, 0);
  }
});
test('storage failure keeps original decision and does not retry execution', async () => {
  const store = { saveText: async () => { throw new Error('ENOSPC'); } }; let warnings = 0, nextCalls = 0;
  const original = { kind: 'accept' };
  assert.equal(await createMathResultListener(store, { onStorageError: () => warnings++ })(exec(), result(), async () => { nextCalls++; return original; }), original);
  assert.equal(warnings, 1); assert.equal(nextCalls, 1);
});
test('cancellation before or during persistence does not project a success', async () => {
  for (const before of [true, false]) {
    const controller = new AbortController(), e = { ...exec(), signal: controller.signal }, original = { kind: 'accept' };
    let writes = 0;
    const store = { async saveText() { writes++; controller.abort(); return { retrievalHint: 'read x' }; } };
    if (before) controller.abort();
    assert.equal(await createMathResultListener(store)(e, result(), async () => original), original);
    assert.equal(writes, before ? 0 : 1);
  }
});
