import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSummaryRequest, collectSummary, summaryBlocks, RESEARCH_SUMMARY_INSTRUCTION, researchSummaryInstruction, finalizeCheckpoint, splitResearchConfig } from '../compaction-core.js';

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
  assert.equal(r.messages.at(-1).content[0].text, researchSummaryInstruction());
  assert.ok(r.messages.at(-1).content[0].text.includes(RESEARCH_SUMMARY_INSTRUCTION));
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

test('research controls are validated and not passed to the official engine', () => {
  const config = Object.freeze({ retainTokens: 8192, auto: true, summaryTargetChars: 2000, summaryMaxChars: 4000 });
  const split = splitResearchConfig(config);
  assert.deepEqual(split.engineConfig, { retainTokens: 8192, auto: true });
  assert.deepEqual(split.summaryPolicy, { targetChars: 2000, maxChars: 4000 });
  assert.equal(config.summaryMaxChars, 4000);
  assert.deepEqual(splitResearchConfig().summaryPolicy, { targetChars: 6000, maxChars: 12000 });
  // Unknown engine settings stay visible to the Host's own validation.
  assert.equal(splitResearchConfig({ unknown: true }).engineConfig.unknown, true);
});
test('invalid research budgets fail before mounting or model usage', () => {
  for (const config of [null, [], false, { summaryMaxChars: 0 }, { summaryMaxChars: Infinity }, { summaryTargetChars: 2.5 }, { summaryTargetChars: 7000, summaryMaxChars: 6000 }, { summaryTargetChars: '6000' }]) {
    assert.throws(() => splitResearchConfig(config));
  }
});
test('the directive reserves both references while keeping the replay prefix unchanged', () => {
  const footer = '历史事件索引: /private/index.txt\n历史分段原文: /private/source.jsonl';
  const input = { messages: [Object.freeze({ role: 'user', content: [{ type: 'text', text: 'critical λ > 0' }] })] };
  const summaryPolicy = { targetChars: 900, maxChars: 1000 };
  const result = buildSummaryRequest(input, agent({ provider: 'p', model: 'm' }), base, undefined, { summaryPolicy, evidenceFooter: footer });
  assert.equal(result.messages[0], input.messages[0]);
  assert.ok(result.messages.at(-1).content[0].text.includes(`最多 ${1000 - footer.length - 2} 个`));
  assert.ok(result.messages.at(-1).content[0].text.includes(footer));
  assert.equal(result.maxTokens, 32768);
  assert.throws(() => researchSummaryInstruction({ targetChars: 600, maxChars: 1000 }, 'x'.repeat(800)), /budget/);
});
test('checkpoint budget includes references, retains full formula, and preserves raw output and usage', () => {
  const blocks = Object.freeze([Object.freeze({ type: 'text', text: 'n²=+1；F(λ)=3λ²−2λ+7；λ>0。' })]);
  const output = Object.freeze({ summary: blocks, rawOutput: blocks, usage: Object.freeze({ inputTokens: 10, outputTokens: 12 }) });
  const footer = '历史事件索引: /x\n历史分段原文: /y\nsessionId: s';
  const size = blocks[0].text.length + 2 + footer.length;
  const complete = finalizeCheckpoint(output, footer, { maxChars: size });
  assert.equal(complete.summary[0].text, blocks[0].text + '\n\n' + footer);
  assert.equal(complete.rawOutput, output.rawOutput);
  assert.equal(complete.usage, output.usage);
  assert.equal(output.summary, blocks);
  assert.throws(() => finalizeCheckpoint(output, footer, { maxChars: size - 1 }), { code: 'SUMMARY_TOO_LONG' });
});
test('UTF-16 limits never truncate an emoji, formula, or incomplete summary', () => {
  const output = { summary: [{ type: 'text', text: '😀'.repeat(100) + '−λ²' }] };
  const footer = 'verified references';
  const length = output.summary[0].text.length + 2 + footer.length;
  assert.equal(finalizeCheckpoint(output, footer, { maxChars: length }).summary[0].text.length, length);
  assert.throws(() => finalizeCheckpoint(output, footer, { maxChars: length - 1 }), { code: 'SUMMARY_TOO_LONG' });
  assert.throws(() => finalizeCheckpoint(output, ''), /references/);
  assert.throws(() => finalizeCheckpoint({ summary: [{ type: 'reasoning', text: 'private' }] }, footer), /text summary/);
  assert.throws(() => finalizeCheckpoint({ summary: [{ type: 'text', text: '  ' }] }, footer), /no text/);
});
