import test from 'node:test';
import assert from 'node:assert/strict';
import { formatMathResult, readableArtifact } from '../math-format.js';

const sageRun = overrides => ({
  mode: 'run', ok: true, result: '4', resultType: 'sage.rings.integer.Integer',
  truncated: false, resultSha256: 'result-hash', error: null,
  stdout: '', stdoutTruncated: false, stdoutSha256: 'stdout-hash',
  stderr: '', stderrTruncated: false, stderrSha256: 'stderr-hash',
  warnings: [], warningsTruncated: false,
  sageVersion: 'SageMath version 10.9', elapsedMs: 12, transportStderr: [], codeSha256: 'code-hash',
  ...overrides,
});
const sageCheck = (label, status, overrides) => ({
  label, status, value: status === 'passed' ? 'True' : status === 'failed' ? 'False' : 'x',
  valueType: status === 'non_boolean' ? 'sage.symbolic.expression.Expression' : 'builtins.bool',
  truncated: false, error: null, valueSha256: 'value-hash', ...overrides,
});
const sageVerify = (checks, overrides) => ({
  mode: 'verify', ok: true, allPassed: checks.every(check => check.status === 'passed'),
  setupError: null, checks, stdout: '', stdoutTruncated: false, stderr: '', stderrTruncated: false,
  warnings: [], warningsTruncated: false, sageVersion: 'SageMath version 10.9', elapsedMs: 12,
  transportStderr: [], codeSha256: 'code-hash', ...overrides,
});
const xactRun = overrides => ({
  ok: true, profile: 'core', result: '{1, 2, 3}', resultSha256: 'result-hash', truncated: false,
  messages: [], loadedPackages: ['xAct`xTensor`', 'xAct`xPert`', 'xAct`xTras`'],
  loadErrors: [], loadMessages: [], elapsedMs: 12, transportStderr: [], ...overrides,
});
const xactCheck = (label, status, overrides) => ({
  label, status, canonicalResidual: status === 'zero' ? '0' : 'x',
  canonicalResidualSha256: 'canonical-hash', canonicalResidualTruncated: false,
  finalResidual: status === 'zero' ? '0' : 'x', finalResidualSha256: 'final-hash', finalResidualTruncated: false,
  unknownHeads: [], messages: [], ...overrides,
});
const xactVerify = (checks, overrides) => ({
  ok: true, allZero: checks.every(check => check.status === 'zero'),
  profile: 'core', pipeline: 'canonical', pipelineSteps: ['ToCanonical'], assumptions: 'x > 0',
  loadedPackages: ['xAct`xTensor`'], loadErrors: [], loadMessages: [], setupMessages: [], checks,
  elapsedMs: 12, transportStderr: [], ...overrides,
});
const canonical = (payload, extra = {}) => ({ content: [{ type: 'text', text: JSON.stringify(payload) }], ...extra });
const math = (code, output) => ({ content: [{ type: 'text', text: `Mathematica code executed:\n\`\`\`wl\n${code}\n\`\`\`\n\nOutput:\n${output}` }] });
const format = (name, payload, budget) => formatMathResult(name, canonical(payload), budget);
const hasBrokenSurrogate = text => /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(text);
function deepFreeze(value) {
  if (value && typeof value === 'object') {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

test('all five exact basenames support native and functions-prefixed MCP names', () => {
  const cases = [
    ['sage_run', 'sage', canonical(sageRun())],
    ['sage_verify_checks', 'sage', canonical(sageVerify([sageCheck('test', 'passed')]))],
    ['xact_run', 'xact', canonical(xactRun())],
    ['xact_verify_residuals', 'xact', canonical(xactVerify([xactCheck('test', 'zero')]))],
    ['evaluate_mathematica', 'mathematica', math('2+2', '4')],
  ];
  for (const [basename, engine, value] of cases) {
    for (const prefix of ['', 'functions.', `mcp__${engine}__`, `functions.mcp__${engine}__`]) {
      const actual = formatMathResult(prefix + basename, value);
      assert.ok(actual, prefix + basename);
      assert.equal(actual.format, engine);
      assert.equal(actual.omitted, 0);
      assert.equal(actual.upstreamTruncated, false);
    }
  }
});

test('normal Sage result keeps type and streams without JSON escaping', () => {
  const result = format('sage_run', sageRun({ stdout: 'first\nsecond\n', stderr: 'diagnostic\n' }));
  assert.match(result.text, /Sage run; ok=true/);
  assert.match(result.text, /result: 4/);
  assert.match(result.text, /resultType: sage\.rings\.integer\.Integer/);
  assert.match(result.text, /stdout: first\n  second/);
  assert.match(result.text, /stderr: diagnostic/);
  assert.doesNotMatch(result.text, /\\n/);
});

test('failed and non_boolean checks do not imply execution failure', () => {
  const result = format('sage_verify_checks', sageVerify([
    sageCheck('boolean failure', 'failed'), sageCheck('symbolic value', 'non_boolean'),
  ], { ok: true, allPassed: false }));
  assert.match(result.text, /ok=true; allPassed=false/);
  assert.match(result.text, /boolean failure: failed/);
  assert.match(result.text, /symbolic value: non_boolean/);
  assert.match(result.text, /value: x/);
  assert.match(result.text, /valueType: sage\.symbolic\.expression\.Expression/);
  assert.doesNotMatch(result.text, /MCP isError=true/);
});

test('a small mixed Sage batch retains every row, exact status, and full error', () => {
  const checks = [
    sageCheck('normal', 'passed'), sageCheck('failure', 'failed'), sageCheck('symbolic', 'non_boolean'),
    sageCheck('exception', 'error', {
      value: '', valueType: '',
      error: { type: 'builtins.ZeroDivisionError', message: 'rational division by zero', traceback: 'Traceback:\n  line 1' },
    }),
  ];
  const result = formatMathResult('sage_verify_checks', canonical(sageVerify(checks, { ok: false }), { isError: true }));
  assert.equal(result.omitted, 0);
  assert.match(result.text, /ok=false; allPassed=false; MCP isError=true/);
  for (const check of checks) assert.ok(result.text.includes(`${check.label}: ${check.status}`));
  assert.match(result.text, /error\.type: builtins.ZeroDivisionError/);
  assert.match(result.text, /error\.message: rational division by zero/);
  assert.match(result.text, /error\.traceback: Traceback:\n      line 1/);
});

test('Sage setup errors, warnings, stderr and transport diagnostics are not hidden', () => {
  const result = format('sage_verify_checks', sageVerify([], {
    ok: false, setupError: { type: 'NameError', message: 'missing setup name' },
    warnings: [{ category: 'RuntimeWarning', message: 'first warning', truncated: false }, { category: 'UserWarning', message: 'second warning', truncated: false }],
    stderr: 'setup stderr', transportStderr: ['transport diagnostic'],
  }));
  for (const text of ['missing setup name', 'first warning', 'second warning', 'setup stderr', 'transport diagnostic']) assert.ok(result.text.includes(text));
  assert.match(result.text, /Checks: 0/);
});

test('normal xAct run retains profile and package context', () => {
  const result = format('xact_run', xactRun({ profile: 'cps', messages: ['HoldForm[General::stop]'] }));
  assert.match(result.text, /xAct run; ok=true/);
  assert.match(result.text, /profile: cps/);
  assert.match(result.text, /result: \{1, 2, 3\}/);
  assert.match(result.text, /loadedPackages\[1\]: xAct`xTensor`/);
  assert.match(result.text, /messages\[1\]: HoldForm\[General::stop\]/);
});

test('xAct residual statuses retain their distinct meanings and normalization context', () => {
  const checks = [
    xactCheck('identity', 'zero'),
    xactCheck('normal form', 'nonzero_normal_form', { canonicalResidual: 'x - y', finalResidual: 'x - y' }),
    xactCheck('symbolic', 'unevaluated', { unknownHeads: ['Global`UnknownHead'], messages: ['HoldForm[ToCanonical::noident]'] }),
    xactCheck('exception', 'error', { messages: ['HoldForm[Power::infy]'] }),
  ];
  const result = format('xact_verify_residuals', xactVerify(checks, { pipeline: 'canonical_contract', pipelineSteps: ['ToCanonical', 'ContractMetric'], assumptions: 'x > 0 && y < 0' }));
  assert.equal(result.omitted, 0);
  for (const check of checks) assert.ok(result.text.includes(`${check.label}: ${check.status}`));
  for (const text of ['profile: core', 'pipeline: canonical_contract', 'ContractMetric', 'assumptions: x > 0 && y < 0', 'canonicalResidual: x - y', 'finalResidual: x - y', 'Global`UnknownHead', 'HoldForm[ToCanonical::noident]']) assert.ok(result.text.includes(text));
  assert.match(result.text, /not mathematical truth judgments/);
  assert.doesNotMatch(result.text, /identity: (?:passed|true)|normal form: (?:failed|false)|proven/);
});

test('zero-with-message keeps warnings even with ok and allZero true', () => {
  const result = format('xact_verify_residuals', xactVerify([
    xactCheck('zero with warning', 'zero', { messages: ['HoldForm[Power::infy]', 'second diagnostic'] }),
  ], { ok: true, allZero: true, loadMessages: ['loader notice'], setupMessages: ['setup notice'] }));
  assert.match(result.text, /ok=true; allZero=true/);
  for (const text of ['zero with warning: zero', 'HoldForm[Power::infy]', 'second diagnostic', 'loader notice', 'setup notice']) assert.ok(result.text.includes(text));
});

test('xAct load errors remain visible when no result is available', () => {
  const payload = xactRun({ ok: false, loadErrors: ['cannot load xAct`xTensor`'], loadMessages: ['load message'], transportStderr: ['kernel exited'] });
  delete payload.result;
  const result = format('xact_run', payload);
  assert.match(result.text, /ok=false/);
  for (const text of ['cannot load xAct`xTensor`', 'load message', 'kernel exited', 'profile: core']) assert.ok(result.text.includes(text));
});

test('upstream truncation detects nested, stream, warning and residual flags', () => {
  const cases = [
    ['sage_run', sageRun({ truncated: true })],
    ['sage_run', sageRun({ stdoutTruncated: true, stderrTruncated: true })],
    ['sage_run', sageRun({ warningsTruncated: true })],
    ['sage_run', sageRun({ warnings: [{ category: 'Warning', message: 'partial warning', truncated: true }] })],
    ['sage_run', sageRun({ ok: false, error: { message: 'partial error', messageTruncated: true, tracebackTruncated: true } })],
    ['sage_verify_checks', sageVerify([sageCheck('partial', 'non_boolean', { truncated: true })])],
    ['xact_verify_residuals', xactVerify([xactCheck('partial', 'unevaluated', { canonicalResidualTruncated: true, finalResidualTruncated: true })])],
    ['xact_run', xactRun({ truncated: true })],
  ];
  for (const [tool, payload] of cases) {
    const result = format(tool, payload);
    assert.equal(result.upstreamTruncated, true, tool);
    assert.match(result.text, /Upstream truncated: true/);
    assert.doesNotMatch(result.text, /display omitted/);
  }
});

test('display clipping has an exact explicit omission marker, not upstream truncation', () => {
  const value = 'a'.repeat(10000);
  const result = format('sage_run', sageRun({ result: value }), 320);
  assert.ok(result);
  assert.ok(result.text.length <= 320);
  assert.equal(result.upstreamTruncated, false);
  assert.equal(result.omitted, 0);
  const match = /result: (a*)… \[display omitted (\d+) chars\]/.exec(result.text);
  assert.ok(match, result.text);
  assert.equal(match[1].length + Number(match[2]), value.length);
  assert.doesNotMatch(result.text, /Upstream truncated/);
});

test('upstream and display truncation can both be true without conflation', () => {
  const result = format('xact_run', xactRun({ result: 'R'.repeat(10000), truncated: true }), 500);
  assert.equal(result.upstreamTruncated, true);
  assert.ok(result.text.length <= 500);
  assert.match(result.text, /Upstream truncated: true/);
  assert.match(result.text, /display omitted \d+ chars/);
});

test('metadata removal affects display only, not false values, zero, or message text', () => {
  const payload = sageRun({
    result: 'sha256 and SageMath version are meaningful inside result strings',
    warnings: [{ category: 'Warning', message: 'hash 123 and version 1', sha256: 'warning-hash', truncated: false }],
    error: { message: 'keep message', messageSha256: 'message-hash' },
    wolframVersion: '14.3', versions: { repeated: 'v1' }, emptyObject: {}, emptyArray: [], elapsedMs: 0, customFalse: false,
  });
  const input = canonical(payload);
  const before = structuredClone(input);
  const result = formatMathResult('sage_run', input);
  for (const text of ['result-hash', 'code-hash', 'warning-hash', 'message-hash', 'sageVersion', 'wolframVersion', 'versions:', 'emptyObject', 'emptyArray', 'warningsTruncated: false']) assert.ok(!result.text.includes(text), text);
  for (const text of [payload.result, 'hash 123 and version 1', 'keep message', 'elapsedMs: 0', 'customFalse: false']) assert.ok(result.text.includes(text), text);
  assert.deepEqual(input, before);
});

test('structuredContent and its JSON mirror are deduplicated without mutation', () => {
  const payload = sageRun();
  const input = canonical(payload, { structuredContent: payload });
  const result = formatMathResult('functions.mcp__sage__sage_run', input);
  assert.equal((result.text.match(/result: 4/g) ?? []).length, 1);
  assert.ok(!result.text.includes('MCP text'));
});

test('supplemental text accompanying structuredContent is preserved', () => {
  const payload = xactRun();
  const input = { structuredContent: payload, content: [
    { type: 'text', text: JSON.stringify(payload) },
    { type: 'text', text: 'Important supplemental diagnostic\nmore detail' },
  ] };
  const result = formatMathResult('xact_run', input);
  assert.match(result.text, /MCP text\[2\]: Important supplemental diagnostic\n  more detail/);
});

test('conflicting structured and textual payloads pass through', () => {
  assert.equal(formatMathResult('sage_run', canonical(sageRun(), { structuredContent: sageRun({ result: '5' }) })), null);
});

test('a large Sage batch reports counts and prioritizes representative adverse outcomes', () => {
  const checks = Array.from({ length: 100 }, (_, index) => sageCheck(`ordinary-${index}`, 'passed'));
  checks.push(sageCheck('important-error', 'error', { value: '', valueType: '', error: { message: 'boom' } }));
  checks.push(sageCheck('important-symbolic', 'non_boolean'));
  checks.push(sageCheck('important-failure', 'failed'));
  const input = canonical(sageVerify(checks, { ok: false }));
  const result = formatMathResult('sage_verify_checks', input, 1200);
  assert.ok(result.text.length <= 1200);
  assert.ok(result.omitted > 0);
  for (const text of ['error=1', 'non_boolean=1', 'failed=1', 'passed=100', 'important-error: error', 'important-symbolic: non_boolean', 'important-failure: failed']) assert.ok(result.text.includes(text), text);
  const visibleRows = [...result.text.matchAll(/^\[\d+\]/gm)].length;
  assert.equal(result.omitted, checks.length - visibleRows);
  assert.match(result.text, new RegExp(`Display omitted: ${result.omitted} of 103 checks\\.`));
  assert.deepEqual(formatMathResult('sage_verify_checks', input, 1200), result);
});

test('a large xAct batch prioritizes unevaluated/nonzero/error and zero diagnostics', () => {
  const checks = Array.from({ length: 80 }, (_, index) => xactCheck(`ordinary-${index}`, 'zero'));
  checks.push(xactCheck('load-sensitive-zero', 'zero', { messages: ['HoldForm[Power::infy]'] }));
  checks.push(xactCheck('important-error', 'error', { messages: ['error message'] }));
  checks.push(xactCheck('important-unevaluated', 'unevaluated', { unknownHeads: ['Global`Unknown'] }));
  checks.push(xactCheck('important-nonzero', 'nonzero_normal_form'));
  const result = format('xact_verify_residuals', xactVerify(checks), 1400);
  assert.ok(result.text.length <= 1400);
  assert.ok(result.omitted > 0);
  for (const text of ['load-sensitive-zero: zero', 'HoldForm[Power::infy]', 'important-error: error', 'important-unevaluated: unevaluated', 'important-nonzero: nonzero_normal_form', 'zero=81', 'unevaluated=1', 'nonzero_normal_form=1']) assert.ok(result.text.includes(text), text);
});

test('long values cannot consume later messages or any small-batch rows', () => {
  const result = format('xact_verify_residuals', xactVerify([
    xactCheck('first', 'nonzero_normal_form', { canonicalResidual: 'x'.repeat(10000), finalResidual: 'x'.repeat(10000) }),
    xactCheck('second', 'zero', { messages: ['DO NOT DROP THIS WARNING', 'or this other warning'] }),
  ], { loadMessages: ['important load message'] }), 1000);
  assert.equal(result.omitted, 0);
  assert.ok(result.text.length <= 1000);
  for (const text of ['first: nonzero_normal_form', 'second: zero', 'DO NOT DROP THIS WARNING', 'or this other warning', 'important load message']) assert.ok(result.text.includes(text));
  assert.match(result.text, /display omitted/);
});

test('upstream flags from omitted rows remain explicit in the summary', () => {
  const checks = Array.from({ length: 100 }, (_, index) => xactCheck(`zero-${index}`, 'zero'));
  checks[99].finalResidualTruncated = true;
  const result = format('xact_verify_residuals', xactVerify(checks), 650);
  assert.ok(result.omitted > 0);
  assert.equal(result.upstreamTruncated, true);
  assert.match(result.text, /Upstream truncated: true/);
});

test('Unicode clipping obeys hard UTF-16 budgets without splitting non-BMP characters', () => {
  for (let budget = 250; budget <= 550; budget++) {
    const result = format('sage_run', sageRun({ result: '😀𝔤🚀'.repeat(1000) }), budget);
    assert.ok(result, String(budget));
    assert.ok(result.text.length <= budget, `${result.text.length} > ${budget}`);
    assert.equal(hasBrokenSurrogate(result.text), false, String(budget));
    assert.match(result.text, /display omitted \d+ chars/);
  }
});

test('multiline values, labels and messages also respect the output budget', () => {
  const input = canonical(xactVerify([
    xactCheck('😀\n'.repeat(80), 'unevaluated', { finalResidual: '😀\n'.repeat(1000), messages: ['🚀\n'.repeat(1000)] }),
  ], { assumptions: 'x > 0\n'.repeat(500) }));
  for (const budget of [800, 1024, 2048, 4096]) {
    const result = formatMathResult('xact_verify_residuals', input, budget);
    assert.ok(result);
    assert.ok(result.text.length <= budget);
    assert.equal(hasBrokenSurrogate(result.text), false);
  }
});

test('invalid or impossibly small budgets safely decline compaction', () => {
  const input = canonical(sageRun());
  for (const budget of [0, 1, 10, -1, 1.5, NaN, Infinity, '4096', null]) assert.equal(formatMathResult('sage_run', input, budget), null);
});

test('Mathematica removes only the fixed wrapper and code echo', () => {
  const actual = 'Power::infy: Infinite expression 1/0 encountered.\nComplexInfinity\nPrint preserved\n';
  const input = math('Print["echo only"]; 1/0', actual);
  const result = formatMathResult('functions.mcp__mathematica__evaluate_mathematica', input);
  assert.equal(result.text, `Mathematica output\n${actual}`);
  assert.equal(result.upstreamTruncated, false);
  assert.equal(result.format, 'mathematica');
  assert.doesNotMatch(result.text, /ok=|success|passed|echo only|Mathematica code executed/);
});

test('Mathematica code containing inline backticks does not confuse the boundary', () => {
  const result = formatMathResult('evaluate_mathematica', math('Print["``` and ` context"]', '``` and ` context\n'));
  assert.equal(result.text, 'Mathematica output\n``` and ` context\n');
  const multiline = formatMathResult('evaluate_mathematica', math('Print["begin\n```\nend"]', 'actual output'));
  assert.equal(multiline.text, 'Mathematica output\nactual output');
});

test('ambiguous Mathematica markers in code or actual output safely pass through', () => {
  const marker = '\n```\n\nOutput:\n';
  assert.equal(formatMathResult('evaluate_mathematica', math(`Print["${marker}"]`, '4')), null);
  assert.equal(formatMathResult('evaluate_mathematica', math('2+2', `4${marker}extra`)), null);
  for (const text of ['4', 'Error: wolframscript missing', 'Mathematica code executed:\r\n```wl\r\n2+2\r\n```\r\n\r\nOutput:\r\n4']) {
    assert.equal(formatMathResult('evaluate_mathematica', { content: [{ type: 'text', text }] }), null);
  }
});

test('Mathematica empty output and diagnostic-looking strings do not infer success or truncation', () => {
  assert.equal(formatMathResult('evaluate_mathematica', math('', '')).text, 'Mathematica output\n');
  const result = formatMathResult('evaluate_mathematica', math('"truncated"', 'FAILED: [truncated] $Failed'));
  assert.equal(result.upstreamTruncated, false);
  assert.equal(result.text, 'Mathematica output\nFAILED: [truncated] $Failed');
});

test('long Mathematica output is explicitly display-clipped, not marked upstream-truncated', () => {
  const result = formatMathResult('evaluate_mathematica', math('Range[1000]', '😀'.repeat(1000)), 200);
  assert.ok(result.text.length <= 200);
  assert.equal(result.upstreamTruncated, false);
  assert.equal(result.omitted, 0);
  assert.equal(hasBrokenSurrogate(result.text), false);
  assert.match(result.text, /display omitted \d+ chars/);
});

test('unknown tool names, suffix lookalikes and malformed canonical shapes pass through', () => {
  for (const name of ['other_tool', 'not_sage_run', 'sage_run_extra', 'mcp__sage__not_sage_run', 'mcp__xact__xact_run_extra', null]) {
    assert.equal(formatMathResult(name, canonical(sageRun())), null);
  }
  const invalid = [
    null, [], {}, { result: '4' }, { content: [] }, { content: [{ type: 'text', text: 'not JSON' }] },
    { content: [{ type: 'image', data: 'abc' }] }, { content: [{ type: 'text', text: 4 }] },
    { ...canonical(sageRun()), structuredContent: null }, { ...canonical(sageRun()), structuredContent: [] },
    { ...canonical(sageRun()), isError: 'yes' }, canonical(null), canonical([]), canonical({ ok: true }),
    canonical({ error: 'connection refused' }, { isError: true }), canonical(sageRun({ mode: 'unknown' })),
    canonical(sageRun({ warnings: 'warning' })), canonical(sageRun({ truncated: 'true' })),
    { content: [...canonical(sageRun()).content, { type: 'text', text: 'unstructured extra' }] },
  ];
  for (const input of invalid) assert.equal(formatMathResult('sage_run', input), null, JSON.stringify(input));
});

test('unknown result/check shapes and unknown statuses pass through rather than guessing', () => {
  assert.equal(format('sage_run', { mode: 'run', ok: true }), null);
  assert.equal(format('sage_run', sageRun({ result: { answer: 4 } })), null);
  assert.equal(format('sage_verify_checks', sageVerify([{ label: 'future', status: 'future_status' }])), null);
  assert.equal(format('sage_verify_checks', sageVerify([{ status: 'passed' }])), null);
  assert.equal(format('xact_run', { ok: true, result: '4' }), null);
  assert.equal(format('xact_verify_residuals', xactVerify([xactCheck('future', 'future_status')])), null);
  assert.equal(format('xact_verify_residuals', { ...xactVerify([]), pipeline: null }), null);
  assert.equal(formatMathResult('evaluate_mathematica', { ...math('2+2', '4'), structuredContent: { value: 4 } }), null);
});

test('frozen canonical input, structured data and isError are never mutated', () => {
  const payload = sageVerify([sageCheck('error', 'error', { error: { type: 'Error', message: 'boom' } })], { ok: false });
  const input = canonical(payload, { structuredContent: payload, isError: true, _meta: { retained: true } });
  const before = structuredClone(input);
  deepFreeze(input);
  assert.ok(formatMathResult('sage_verify_checks', input));
  assert.ok(readableArtifact('sage_verify_checks', input));
  assert.deepEqual(input, before);
  assert.equal(input.isError, true);
  assert.equal(input.structuredContent, payload);
});

test('readable artifacts contain every row and full multiline values omitted inline', () => {
  const payload = sageVerify(Array.from({ length: 100 }, (_, index) => sageCheck(`row-${index}`, 'passed')));
  payload.stdout = 'first\n' + 'a'.repeat(5000) + '\nlast';
  const input = canonical(payload);
  const compact = formatMathResult('sage_verify_checks', input, 1000);
  const artifact = readableArtifact('sage_verify_checks', input);
  assert.ok(compact.omitted > 0);
  for (let index = 0; index < 100; index++) assert.ok(artifact.includes(`row-${index}: passed`));
  assert.match(artifact, /stdout: first\n/);
  assert.match(artifact, /last/);
  assert.doesNotMatch(artifact, /display omitted|Display omitted/);
  assert.ok(artifact.split('\n').every(line => line.length <= 1000));
});

test('readable artifact wrapping preserves all non-BMP characters with maximum line length 1000', () => {
  const output = '😀𝔤🚀'.repeat(2000);
  const input = math('large expression', output);
  const artifact = readableArtifact('evaluate_mathematica', input);
  assert.ok(artifact.split('\n').every(line => line.length <= 1000));
  assert.equal(hasBrokenSurrogate(artifact), false);
  const body = artifact.slice(artifact.indexOf('Mathematica output\n') + 'Mathematica output\n'.length);
  assert.equal(body.replaceAll('\n', ''), output);
  assert.doesNotMatch(artifact, /large expression/);
});

test('unknown readable artifacts retain canonical fields without interpreting or stripping metadata', () => {
  const input = { content: [{ type: 'text', text: 'unknown data' }], unexpectedSha256: 'keep unknown metadata' };
  const artifact = readableArtifact('unknown_tool', input);
  assert.match(artifact, /unknown data/);
  assert.match(artifact, /unexpectedSha256/);
  assert.match(artifact, /keep unknown metadata/);
  assert.ok(artifact.split('\n').every(line => line.length <= 1000));
});

test('non-JSON values and cycles cannot throw or mutate input', () => {
  const cyclic = canonical(sageRun());
  cyclic.cycle = cyclic;
  assert.equal(formatMathResult('sage_run', cyclic), null);
  assert.match(readableArtifact('sage_run', cyclic), /Cannot render non-JSON/);
  assert.equal(formatMathResult('sage_run', { ...canonical(sageRun()), bad: 1n }), null);
});
