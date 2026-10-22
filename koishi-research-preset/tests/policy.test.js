import test from 'node:test';
import assert from 'node:assert/strict';
import { MANAGEMENT_TOOLS, inheritedManagementTools, apply } from '../index.js';
import { createMathResultListener } from '../math-policy.js';

const exec = () => ({ name: 'mcp__sage__sage_run', callId: 'call1', arguments: { code: '2+2' }, agent: { id: 'session1' }, signal: new AbortController().signal });
const result = () => ({ isError: false, value: { content: [{ type: 'text', text: 'full payload' }], structuredContent: { mode: 'run', ok: true, result: '4', resultType: 'sage.rings.integer.Integer', truncated: false, error: null, stdout: '', stderr: '', warnings: [], stdoutTruncated: false, stderrTruncated: false } }, content: [{ type: 'text', text: 'full payload' }] });
const storage = () => {
  const saved = [];
  return { saved, async saveText(input) { saved.push(input); return { locator: `/private/file-${saved.length}`, bytes: Buffer.byteLength(input.content), retrievalHint: 'Use read with offset/limit, or grep this path to search within it.' }; } };
};

// Public-contract double, not a replacement for live HostLoader validation:
// unknown deny names fail; change notifications are synchronous/unfiltered;
// masks intersect on inherited tools, while each scope's own tools stay visible.
function toolPolicyFixture() {
  const research = {}, child = { parent: research }, standard = {};
  const layers = new Map(), restrictions = new Set(), listeners = new Set(), effects = [];
  const filters = [], modes = [];
  const layer = scope => {
    if (!layers.has(scope)) layers.set(scope, new Map());
    return layers.get(scope);
  };
  const chain = scope => scope ? [...chain(scope.parent), scope] : [];
  const notify = () => { for (const listener of [...listeners]) listener(); };
  const owned = cleanup => {
    let active = true;
    const dispose = () => { if (active) { active = false; cleanup(); } };
    effects.push(dispose); return dispose;
  };
  const visible = scope => {
    const ancestors = chain(scope), definitions = new Map(layer(undefined));
    for (const ancestor of ancestors.slice(0, -1)) for (const entry of layer(ancestor)) definitions.set(...entry);
    for (const [name] of definitions) {
      if ([...restrictions].some(mask => ancestors.includes(mask.scope) && mask.deny.has(name))) definitions.delete(name);
    }
    if (scope) for (const entry of layer(scope)) definitions.set(...entry);
    return definitions;
  };
  const schemas = scope => [...visible(scope).values()].map(({ execute, ...schema }) => structuredClone(schema));
  const ctx = {
    tools: {
      schemas,
      presentAs(mode) { modes.push(mode); return owned(() => { modes.pop(); }); },
      restrict(filter) {
        assert.deepEqual(Object.keys(filter), ['deny'], 'policy must never create an allowlist');
        assert.ok(filter.deny.length > 0);
        for (const name of filter.deny) assert.ok(layer(undefined).has(name), `unknown global tool: ${name}`);
        filters.push(structuredClone(filter));
        const mask = { scope: research, deny: new Set(filter.deny) };
        restrictions.add(mask);
        const dispose = owned(() => { restrictions.delete(mask); notify(); });
        notify(); return dispose;
      },
    },
    on(event, listener) {
      assert.equal(event, 'tools/change'); listeners.add(listener);
      return owned(() => { listeners.delete(listener); });
    },
  };
  const register = (name, scope) => {
    assert.ok(!layer(scope).has(name));
    const definition = { name, description: `Tool ${name}`, parameters: { type: 'object', properties: { text: { type: 'string' } } }, execute: args => args };
    layer(scope).set(name, definition); notify();
    return () => { if (layer(scope).get(name) === definition) { layer(scope).delete(name); notify(); } };
  };
  return {
    ctx, research, child, standard, register, schemas, filters, modes, listeners, restrictions, notify,
    get: (name, scope) => visible(scope).get(name),
    dispose: () => { for (const cleanup of effects.splice(0).reverse()) cleanup(); },
  };
}

test('tool policy denies only exact known global management tools, not research/search tools', () => {
  const f = toolPolicyFixture();
  for (const name of ['skills_mcp_manager', 'session_search', 'mcp__sage__sage_run', 'working_directory', 'read', 'plugin_manager']) f.register(name);
  assert.deepEqual(inheritedManagementTools(f.ctx.tools), ['plugin_manager', 'skills_mcp_manager']);
  apply(f.ctx);
  assert.deepEqual(f.modes, ['native']);
  assert.deepEqual(f.filters, [{ deny: ['plugin_manager', 'skills_mcp_manager'] }]);
  assert.deepEqual(f.schemas(f.research).map(tool => tool.name), ['session_search', 'mcp__sage__sage_run', 'working_directory', 'read']);
  assert.deepEqual(inheritedManagementTools({ schemas: () => [] }), []);
});

test('every management tool registered after apply is hidden without recursive restriction churn', () => {
  const f = toolPolicyFixture();
  apply(f.ctx);
  assert.deepEqual(f.filters, []);
  for (const name of MANAGEMENT_TOOLS) {
    f.register(name);
    assert.equal(f.get(name, f.research), undefined);
    assert.equal(f.get(name, f.child), undefined);
    assert.ok(f.get(name, f.standard));
    assert.ok(f.get(name));
  }
  assert.deepEqual(f.schemas(f.research), []);
  assert.deepEqual(f.filters, MANAGEMENT_TOOLS.map(name => ({ deny: [name] })));
  for (let n = 0; n < 10; n++) f.notify();
  assert.equal(f.filters.length, MANAGEMENT_TOOLS.length);
});

test('late skills manager remains denied through unregister/re-register without lifting any mask', () => {
  const f = toolPolicyFixture(); f.register('plugin_manager'); apply(f.ctx);
  const unregister = f.register('skills_mcp_manager');
  assert.equal(f.get('skills_mcp_manager', f.research), undefined);
  unregister(); f.notify(); f.register('skills_mcp_manager');
  assert.equal(f.get('skills_mcp_manager', f.research), undefined);
  assert.equal(f.get('skills_mcp_manager', f.child), undefined);
  assert.deepEqual(f.filters, [{ deny: ['plugin_manager'] }, { deny: ['skills_mcp_manager'] }]);
  assert.equal(f.restrictions.size, 2);
});

test('policy keeps ordinary schemas and call inputs unchanged and does not expand scope', () => {
  const f = toolPolicyFixture();
  f.register('read'); f.register('mcp__sage__sage_run', f.research);
  f.register('structured_output', f.child); f.register('standard_only', f.standard);
  // A management name existing only in another scope is not a global target.
  f.register('workflow', f.standard);
  const globalBefore = f.schemas(), standardBefore = f.schemas(f.standard);
  const researchBefore = f.schemas(f.research), childBefore = f.schemas(f.child);
  const definition = f.get('read', f.research), definitionBefore = structuredClone(f.schemas()[0]);
  const args = Object.freeze({ text: 'unchanged λ payload' });
  apply(f.ctx);
  assert.deepEqual(f.filters, []);
  assert.deepEqual(f.schemas(), globalBefore); assert.deepEqual(f.schemas(f.standard), standardBefore);
  assert.deepEqual(f.schemas(f.research), researchBefore); assert.deepEqual(f.schemas(f.child), childBefore);
  for (const name of ['web_search', 'skills_mcp_manager_extra', 'mcp__sage__sage_verify_checks']) f.register(name);
  const standardWithLateTools = f.schemas(f.standard);
  f.register('skills_mcp_manager');
  assert.deepEqual(f.schemas(f.standard).filter(tool => tool.name !== 'skills_mcp_manager'), standardWithLateTools);
  assert.ok(f.get('skills_mcp_manager', f.standard)); assert.ok(f.get('workflow', f.standard));
  for (const name of ['read', 'web_search', 'skills_mcp_manager_extra', 'mcp__sage__sage_run', 'mcp__sage__sage_verify_checks']) {
    assert.ok(f.get(name, f.research)); assert.ok(f.get(name, f.child));
  }
  assert.ok(f.get('structured_output', f.child));
  assert.equal(f.get('structured_output', f.research), undefined);
  assert.equal(f.get('standard_only', f.research), undefined);
  assert.equal(f.get('mcp__sage__sage_run', f.standard), undefined);
  assert.equal(f.get('read', f.research), definition);
  assert.deepEqual(f.schemas(f.research).find(tool => tool.name === 'read'), definitionBefore);
  assert.equal(definition.execute(args), args); assert.deepEqual(args, { text: 'unchanged λ payload' });
  assert.deepEqual(f.filters, [{ deny: ['skills_mcp_manager'] }]);
});

test('existing restrictions stay intersected while child-owned tools remain visible', () => {
  const f = toolPolicyFixture();
  f.register('read'); f.register('web_search'); f.register('structured_output', f.child);
  f.ctx.tools.restrict({ deny: ['read'] });
  apply(f.ctx); f.register('skills_mcp_manager');
  assert.deepEqual(f.schemas(f.research).map(tool => tool.name), ['web_search']);
  assert.deepEqual(f.schemas(f.child).map(tool => tool.name), ['web_search', 'structured_output']);
  assert.ok(f.get('read', f.standard)); assert.ok(f.get('skills_mcp_manager', f.standard));
  assert.deepEqual(f.filters, [{ deny: ['read'] }, { deny: ['skills_mcp_manager'] }]);
});

test('scoped policy unload releases its listener and masks without reregistering them', () => {
  const f = toolPolicyFixture(); f.register('plugin_manager'); apply(f.ctx); f.register('skills_mcp_manager');
  f.dispose();
  assert.equal(f.listeners.size, 0); assert.equal(f.restrictions.size, 0); assert.deepEqual(f.modes, []);
  assert.ok(f.get('plugin_manager', f.research)); assert.ok(f.get('skills_mcp_manager', f.child));
  f.register('workflow'); assert.equal(f.filters.length, 2);
});

test('a failed restrict does not mark an uninstalled mask as covered', () => {
  const f = toolPolicyFixture(), restrict = f.ctx.tools.restrict;
  f.register('skills_mcp_manager');
  f.ctx.tools.restrict = () => { throw new Error('restriction failed'); };
  assert.throws(() => apply(f.ctx), /restriction failed/);
  f.ctx.tools.restrict = restrict; f.notify();
  assert.deepEqual(f.filters, [{ deny: ['skills_mcp_manager'] }]);
  assert.equal(f.get('skills_mcp_manager', f.research), undefined);
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
