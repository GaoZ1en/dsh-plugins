import test from 'node:test';
import assert from 'node:assert/strict';
import { importHostModule } from '../host-api.js';
import { apply as applyCompaction } from '../compaction.js';

const context = entries => ({ loader: { *entries() { yield* entries; } }, spillStore: { async saveText() { throw new Error('not called by mounting tests'); } } });
test('Host imports preserve an already-loaded namespace identity', async () => {
  const namespace = { exportedClass: class {} };
  const entry = { options: { name: '@core/example' }, moduleNamespace: namespace };
  assert.equal(await importHostModule(context([entry]), '@core/example'), namespace);
});
test('disabled-entry import uses its owning tree without activation or mutation', async () => {
  const namespace = { exportedClass: class {} }; let imported;
  const entry = { options: { name: '@core/example', disabled: true }, parent: { tree: { async import(name) { imported = name; return namespace; } } } };
  assert.equal(await importHostModule(context([entry]), '@core/example'), namespace);
  assert.equal(imported, '@core/example'); assert.equal(entry.options.disabled, true); assert.ok(!Object.hasOwn(entry, 'moduleNamespace'));
  await assert.rejects(() => importHostModule(context([]), '@core/missing'), /no matching Loader entry/);
});
test('compaction factory mounts exactly one genuine subclass with unmodified config', async () => {
  class Base { static Config = { schema: 'base' }; static inject = ['llm']; }
  class Assembler {} class LlmError extends Error {}
  const ctx = context([
    { options: { name: '@deepseek-ai/dsh-compaction-basic' }, moduleNamespace: { BasicCompactionEngine: Base } },
    { options: { name: '@deepseek-ai/dsh-llm' }, moduleNamespace: { BlockAssembler: Assembler, LlmError } },
  ]);
  const config = Object.freeze({ auto: true, maxTokens: 32768 }); let calls = 0;
  ctx.plugin = async (Implementation, received) => {
    calls++; assert.equal(Object.getPrototypeOf(Implementation), Base);
    assert.equal(Implementation.Config, Base.Config); assert.equal(Implementation.inject, Base.inject);
    assert.deepEqual(received, config); assert.equal(typeof Implementation.prototype.summarize, 'function');
    for (const inherited of ['compactIfNeeded', 'compactNow', 'compactRegion']) assert.equal(Object.hasOwn(Implementation.prototype, inherited), false);
  };
  await applyCompaction(ctx, config); assert.equal(calls, 1);
});
