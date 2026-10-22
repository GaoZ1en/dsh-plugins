import test from 'node:test';
import assert from 'node:assert/strict';
import { apply } from '../compaction.js';

async function fixture({ body = 'λ>0；F(λ)=3λ²−2λ+7；F(2)=15，14 已排除。', failStore, finish = { kind: 'stop' }, policy = {}, controller } = {}) {
  const messages = [
    { id: 'system', role: 'system', content: [{ type: 'text', text: 'SYSTEM_NOT_FOR_EXPORT' }] },
    { id: 'user', role: 'user', content: [{ type: 'text', text: 'Define λ>0. Keep source and failed branch.' }] },
    { id: 'answer', role: 'assistant', content: [{ type: 'text', text: 'F(λ)=3λ²−2λ+7；F(2)=15。' }] },
  ];
  const seqs = [40, 2, 8];
  const events = new Map(messages.map((message, index) => [seqs[index], { seq: seqs[index], type: message.role === 'system' ? 'system/message' : `${message.role}/message`, data: message.role === 'user' ? message : { message } }]));
  const history = { tools: [], updates: [] };
  const session = {
    id: 'adapter-test', surface: { nodes: seqs }, eventAt: seq => events.get(seq),
    deriveEventMessage: event => event.type === 'user/message' ? event.data : event.data.message,
    requestHeader: () => ({ config: { provider: 'real-host-identity', model: 'test-model' } }),
    toolHistory: () => history,
  };
  class Base { static Config = {}; static inject = ['llm']; constructor(ctx, config) { this.ctx = ctx; this.config = config; } }
  class LlmError extends Error { constructor(message, code, failure) { super(message); this.code = code; this.failure = failure; } }
  class Assembler {
    finish = { kind: 'stop' }; usage = { inputTokens: 100, outputTokens: 10 }; text = '';
    push(chunk) { if (chunk.type === 'text-delta') this.text += chunk.text; if (chunk.type === 'finish') this.finish = chunk.reason; }
    blocks() { return [{ type: 'text', text: this.text }]; }
  }
  const entries = [
    { options: { name: '@deepseek-ai/dsh-compaction-basic' }, moduleNamespace: { BasicCompactionEngine: Base } },
    { options: { name: '@deepseek-ai/dsh-llm' }, moduleNamespace: { BlockAssembler: Assembler, LlmError } },
  ];
  const writes = []; const calls = []; let instance;
  const ctx = {
    loader: { *entries() { yield* entries; } },
    spillStore: { async saveText(input) {
      if (failStore) throw new Error('ENOSPC');
      writes.push(input);
      if (controller && writes.length === 1) controller.abort();
      return { locator: `/private/${input.suggestedName}`, bytes: Buffer.byteLength(input.content), retrievalHint: 'Read the locator.' };
    } },
    llm: { async *stream(options) {
      calls.push(options); assert.equal(writes.length, 2, 'both artifacts must precede model usage');
      yield { type: 'text-delta', index: 0, text: body };
      yield { type: 'finish', reason: finish };
    } },
    async plugin(Implementation, config) { instance = new Implementation(ctx, config); },
  };
  await apply(ctx, { maxTokens: 32768, summarizationProvider: '', summarizationModel: '', ...policy });
  return { ctx, session, messages, writes, calls, instance, history, LlmError };
}

test('adapter archives before summarizing and appends bounded actual locators without falsifying raw output', async () => {
  const f = await fixture();
  const original = structuredClone(f.messages);
  const result = await f.instance.summarize({ messages: f.messages, tools: [] }, { session: f.session });
  assert.equal(f.calls.length, 1);
  assert.deepEqual(f.messages, original);
  assert.equal(f.calls[0].messages[0], f.messages[0]);
  assert.equal(f.calls[0].toolHistory, f.history);
  assert.ok(f.writes.every(write => !write.content.includes('SYSTEM_NOT_FOR_EXPORT')));
  assert.ok(result.summary[0].text.includes('历史事件索引: /private/'));
  assert.ok(result.summary[0].text.includes('历史分段原文: /private/'));
  assert.ok(!result.rawOutput[0].text.includes('/private/'));
  assert.equal(result.llmStreamCall, true); assert.equal(result.maxTokens, 32768);
  assert.deepEqual(result.usage, { inputTokens: 100, outputTokens: 10 });
  assert.ok(result.summary[0].text.length <= 12000);
});
test('storage failure does not call the model or mutate messages', async () => {
  const f = await fixture({ failStore: true });
  const original = structuredClone(f.messages);
  await assert.rejects(() => f.instance.summarize({ messages: f.messages }, { session: f.session }), /ENOSPC/);
  assert.equal(f.calls.length, 0); assert.deepEqual(f.messages, original);
});
test('cancellation after first artifact stops before second write or model call', async () => {
  const controller = new AbortController(); const f = await fixture({ controller });
  await assert.rejects(() => f.instance.summarize({ messages: f.messages }, { session: f.session }, controller.signal), { name: 'AbortError' });
  assert.equal(f.calls.length, 0); assert.equal(f.writes.length, 1);
});
test('oversized text is rejected after one call, not truncated or automatically rewritten', async () => {
  const f = await fixture({ body: 'a'.repeat(2000), policy: { summaryTargetChars: 600, summaryMaxChars: 1200 } });
  await assert.rejects(() => f.instance.summarize({ messages: f.messages }, { session: f.session }), { code: 'SUMMARY_TOO_LONG' });
  assert.equal(f.calls.length, 1);
  assert.ok(!Object.hasOwn(f.instance.config, 'summaryMaxChars'));
});
test('provider failures retain the exact Host LlmError identity', async () => {
  const failure = { message: 'provider failed', code: 'TEST_PROVIDER_ERROR' };
  const f = await fixture({ finish: { kind: 'error', failure } });
  await assert.rejects(() => f.instance.summarize({ messages: f.messages }, { session: f.session }), error => error instanceof f.LlmError && error.failure === failure);
});
