import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryRequest, collectSummary, summaryBlocks, RESEARCH_SUMMARY_INSTRUCTION } from '../compaction-core.js';

const history = { tools: [], updates: [] };
const agent = (config, options = {}) => ({ options, session: { id: 'test-session', requestHeader: () => config ? { config } : undefined, toolHistory: () => history } });
const base = { maxTokens: 32768, summarizationProvider: '', summarizationModel: '', modelPolicies: [] };

test('durable route, prefix, tool history, cancellation and audit fields are preserved', () => {
  const message = Object.freeze({ role: 'user', content: [{ type: 'text', text: 'signature -+++; boundary Γ' }] });
  const tools = Object.freeze([{ name: 'sage_run', description: 'x', parameters: {} }]);
  const input = Object.freeze({ messages: Object.freeze([message]), tools });
  const signal = new AbortController().signal;
  const r = buildSummaryRequest(input, agent({ provider: 'p', model: 'm', reasoningEffort: 'max' }, { provider: 'old', model: 'old' }), base, signal);
  assert.equal(r.provider, 'p'); assert.equal(r.model, 'm'); assert.equal(r.messages[0], message);
  assert.equal(input.messages.length, 1); assert.notEqual(r.messages, input.messages);
  assert.deepEqual(r.tools, tools); assert.notEqual(r.tools, tools);
  assert.equal(r.toolHistory, history); assert.equal(r.signal, signal);
  assert.equal(r.purpose, 'compaction'); assert.equal(r.maxTokens, 32768);
  assert.equal(r.messages.at(-1).content[0].text, RESEARCH_SUMMARY_INSTRUCTION);
  for (const term of ['假设', '边界条件', '规范选择', '关键公式', '正负号', '核验', '文件', '截断']) assert.ok(RESEARCH_SUMMARY_INSTRUCTION.includes(term));
});
test('fallback route and missing tools remain faithful to the base contract', () => {
  const r = buildSummaryRequest({ messages: [] }, agent(undefined, { provider: 'p', model: 'm' }), base);
  assert.equal(r.provider, 'p'); assert.ok(!Object.hasOwn(r, 'tools')); assert.ok(!Object.hasOwn(r, 'signal'));
  assert.throws(() => buildSummaryRequest({ messages: [] }, agent(undefined), base), /route/);
});
test('explicit summarizer and exact model policy override follow the current route', () => {
  const config = { ...base, summarizationProvider: 'default-p', summarizationModel: 'default-m', modelPolicies: [{ provider: 'p', model: 'm', summarizationProvider: 'summary-p', summarizationModel: 'summary-m', maxTokens: 8192 }] };
  const r = buildSummaryRequest({ messages: [] }, agent({ provider: 'p', model: 'm' }), config);
  assert.equal(r.provider, 'summary-p'); assert.equal(r.model, 'summary-m'); assert.equal(r.maxTokens, 8192);
  assert.throws(() => buildSummaryRequest({ messages: [] }, agent({ provider: 'p', model: 'm' }), { ...base, maxTokens: 0 }), /budget/);
});
test('single-field route override falls back only the omitted field', () => {
  const r = buildSummaryRequest({ messages: [] }, agent({ provider: 'p', model: 'm' }), { ...base, summarizationModel: 'other' });
  assert.equal(r.provider, 'p'); assert.equal(r.model, 'other');
});

test('stream collection requires a real finish chunk and preserves usage', async () => {
  class Assembler {
    finish = { kind: 'stop' }; usage = { inputTokens: 10, outputTokens: 5 };
    push(chunk) { if (chunk.type === 'finish') this.finish = chunk.finish; }
    blocks() { return [{ type: 'text', text: '完整研究检查点' }]; }
  }
  await assert.rejects(() => collectSummary([{ type: 'text-delta', index: 0, text: 'partial' }], Assembler), /finish chunk/);
  const complete = await collectSummary([{ type: 'finish', finish: { kind: 'stop' } }], Assembler);
  assert.equal(complete.summary[0].text, '完整研究检查点'); assert.equal(complete.usage.outputTokens, 5);
  await assert.rejects(() => collectSummary([{ type: 'finish', finish: { kind: 'max-tokens' } }], Assembler), { code: 'MAX_TOKENS' });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => collectSummary([{ type: 'finish', finish: { kind: 'stop' } }], Assembler, controller.signal), { name: 'AbortError' });
});

test('summary accepts nonempty text, not reasoning as checkpoint text', () => {
  const blocks = [{ type: 'reasoning', text: 'private intermediate' }, { type: 'text', text: 'R_ab = Λ g_ab；n²=+1；尚未核验边界项。' }];
  assert.deepEqual(summaryBlocks(blocks, { kind: 'stop' }), [blocks[1]]);
});
test('failed, interrupted, empty and visual summaries cannot replace history', () => {
  for (const finish of [undefined, { kind: 'max-tokens' }, { kind: 'aborted', failure: { code: 'ABORTED', message: 'cancel' } }, { kind: 'error', failure: { code: 'X', message: 'error' } }, { kind: 'tool-calls' }]) {
    assert.throws(() => summaryBlocks([{ type: 'text', text: 'partial' }], finish));
  }
  for (const blocks of [[], [{ type: 'text', text: ' ' }], [{ type: 'reasoning', text: 'not a checkpoint' }], [{ type: 'image' }], [{ type: 'tool-call' }], [{ type: 'file' }]]) {
    assert.throws(() => summaryBlocks(blocks, { kind: 'stop' }));
  }
});
