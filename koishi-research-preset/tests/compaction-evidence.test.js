import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveCompactionInput } from '../compaction-evidence.js';

const text = (body, role = 'user', id) => ({ role, ...(id === undefined ? {} : { id }), content: [{ type: 'text', text: body }] });
const source = { kind: 'session-reference', sessionId: 'session-evidence-test', label: 'Research compaction evidence' };

function freeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(freeze);
    Object.freeze(value);
  }
  return value;
}

function fixture(entries) {
  const events = entries.map(([seq, message, extra = {}]) => freeze({ seq, type: `${message?.role ?? 'system'}/message`, data: { message }, ...extra }));
  const projections = new Map(entries.map(([seq, message]) => [seq, message]));
  freeze(entries);
  const nodes = freeze(entries.map(([seq]) => seq));
  const reads = [];
  const derived = [];
  const session = {
    id: 'session-evidence-test',
    surface: freeze({ nodes }),
    eventAt(seq) { reads.push(seq); return events.find(event => event.seq === seq); },
    deriveEventMessage(event) { derived.push(event.seq); return projections.get(event.seq); },
  };
  // Accidental traversal of persistent history, toolHistory, or private state is
  // an immediate test failure; the fixture exposes only the approved surface.
  for (const key of ['events', 'snapshotEvents', 'ownEvents', 'append', 'requestHeader', 'toolHistory']) {
    Object.defineProperty(session, key, { get() { throw new Error(`Forbidden session access: ${key}`); } });
  }
  return { session, events, reads, derived };
}

function storage({ locators = ['/actual/store/readable.jsonl', '/actual/store/index.txt'], beforeReturn } = {}) {
  const calls = [];
  const refs = [];
  const store = {
    async saveText(request) {
      const index = calls.length;
      calls.push(structuredClone(request));
      if (beforeReturn) await beforeReturn(index, request);
      const locator = locators[index];
      const ref = { locator, bytes: Buffer.byteLength(request.content), retrievalHint: 'storage-owned hint, not prompt text' };
      refs.push(ref);
      return ref;
    },
  };
  return { store, calls, refs };
}

function decoded(calls) {
  assert.equal(calls[0].suggestedName, 'research-context-readable.jsonl');
  return calls[0].content.trimEnd().split('\n').map(line => JSON.parse(line));
}

function field(rows, eventSeq, blockIndex, name) {
  const parts = rows.filter(row => row.kind === 'chunk' && row.eventSeq === eventSeq && row.blockIndex === blockIndex && row.field === name).sort((a, b) => a.part - b.part);
  assert.ok(parts.length, `Missing ${eventSeq}/${blockIndex}/${name}`);
  assert.deepEqual(parts.map(row => row.part), parts.map((_, i) => i));
  for (let i = 0; i < parts.length; i += 1) {
    const part = parts[i];
    assert.equal(typeof part.text, 'string');
    assert.ok(part.text.length <= 200, `Oversized text: ${part.text.length}`);
    if (i) {
      const before = parts[i - 1].text.charCodeAt(parts[i - 1].text.length - 1);
      const after = part.text.charCodeAt(0);
      assert.ok(!(before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff), 'Split surrogate pair');
    }
  }
  return parts.map(row => row.text).join('');
}

function assertSchema(rows) {
  assert.deepEqual(rows[0], { schemaVersion: 1, kind: 'header', sessionId: 'session-evidence-test' });
  for (const row of rows.slice(1)) {
    assert.ok(Number.isSafeInteger(row.eventSeq));
    assert.ok(['user', 'assistant', 'tool'].includes(row.role));
    if (row.kind === 'message') continue;
    assert.ok(row.blockIndex === null || Number.isSafeInteger(row.blockIndex));
    assert.equal(typeof row.blockType, 'string');
    assert.equal(typeof row.field, 'string');
    if (row.kind === 'chunk') {
      assert.ok(Number.isSafeInteger(row.part) && row.part >= 0);
      assert.equal(typeof row.text, 'string');
      assert.ok(row.text.length <= 200);
    } else {
      assert.equal(row.kind, 'value');
      assert.ok(['boolean', 'number'].includes(typeof row.value));
    }
  }
}

async function archived(entries, messages = entries.filter(([, message]) => message !== null).map(([, message]) => message), options = {}) {
  const f = fixture(entries);
  const s = storage(options.storage);
  const input = freeze({ messages, ...(options.tools === undefined ? {} : { tools: options.tools }) });
  const result = await archiveCompactionInput({ input, session: f.session, store: s.store, signal: options.signal });
  return { ...f, ...s, input, result, rows: decoded(s.calls) };
}

async function rejectsWithoutWrites(entries, messages, pattern = /match|empty|ambiguous|invalid|duplicate/) {
  const { session } = fixture(entries);
  const { store, calls } = storage();
  await assert.rejects(() => archiveCompactionInput({ input: { messages }, session, store }), pattern);
  assert.equal(calls.length, 0);
}

test('JSONL v1 reconstructs exact Chinese/English formula text and long edit old/new arguments', async () => {
  const body = 'a'.repeat(199) + '😀' + '\r\n中文 English: δL=E·δφ+dθ; Ω_Σ=∫_Σω，n²=−1.\\alpha\t' + '量子🧮gravity'.repeat(130) + '\u0000\u2028\u2029';
  const oldString = 'old_string 原式 R_{ab} − ½Rg_{ab}=8πGT_{ab}\n'.repeat(60);
  const newString = 'new_string: E=mc² 😀\nδQ_ξ−ι_ξθ；边界 Γ，(+---)\n'.repeat(85);
  const args = JSON.stringify({ file_path: '/研究路径/公式.tex', old_string: oldString, new_string: newString, replace_all: false });
  const assistant = { role: 'assistant', id: 'assistant-edit', content: [{ type: 'tool-call', id: 'call-edit', name: 'edit', arguments: args }] };
  const { rows, calls, result, refs } = await archived([[80, text(body)], [12, assistant]]);
  assertSchema(rows);
  assert.equal(field(rows, 80, 0, 'text'), body);
  assert.equal(field(rows, 12, 0, 'name'), 'edit');
  assert.equal(field(rows, 12, 0, 'id'), 'call-edit');
  assert.equal(field(rows, 12, 0, 'arguments'), args);
  assert.deepEqual(JSON.parse(field(rows, 12, 0, 'arguments')), { file_path: '/研究路径/公式.tex', old_string: oldString, new_string: newString, replace_all: false });
  assert.deepEqual(result.eventSeqs, [80, 12]);
  assert.equal(result.viewRef, refs[0]);
  assert.equal(result.indexRef, refs[1]);
  assert.equal(calls.length, 2);
  for (const call of calls) {
    assert.deepEqual(call.owner, { sessionId: 'session-evidence-test' });
    assert.deepEqual(call.source, source);
  }
  assert.equal(calls[1].suggestedName, 'research-context-index.txt');
  assert.ok(!result.footer.includes(body));
  assert.ok(!result.footer.includes(oldString));
  assert.ok(result.footer.includes(`历史事件索引: ${refs[1].locator}`));
  assert.ok(result.footer.includes(`历史分段原文: ${refs[0].locator}`));
  assert.ok(result.footer.includes('sessionId: session-evidence-test'));
  assert.match(result.footer, /先用 read.*索引.*read.*limit:10/);
});

test('all surrogate boundaries, empty strings and unpaired original UTF-16 units survive unchanged', async () => {
  const values = ['', '😀'.repeat(400), '汉'.repeat(199) + '🚀', 'x'.repeat(200) + '😀', '😃'.repeat(99) + 'x😀Z', 'x\ud800y\udc00z', 'a'.repeat(199) + '\ud800b'];
  const entries = values.map((value, i) => [100 + i, text(value)]);
  const { rows } = await archived(entries);
  for (const [i, original] of values.entries()) assert.equal(field(rows, 100 + i, 0, 'text'), original);
  assertSchema(rows);
});

test('unique contiguous projection is selected in surface order, not a numeric seq interval', async () => {
  const a = text('outside before', 'user', 'before');
  const b = text('selected one', 'user', 'one');
  const c = text('selected two', 'assistant', 'two');
  const d = text('outside after', 'user', 'after');
  const { result, rows, reads } = await archived([[2, a], [95, b], [11, null], [6, c], [41, d]], [structuredClone(b), structuredClone(c)]);
  assert.deepEqual(result.eventSeqs, [95, 6]);
  assert.deepEqual(reads, [2, 95, 11, 6, 41]);
  assert.deepEqual(rows.filter(row => row.kind === 'message').map(row => row.eventSeq), [95, 6]);
  assert.ok(!JSON.stringify(rows).includes('outside'));
  await rejectsWithoutWrites([[2, a], [95, b], [6, c]], [a, c], /contiguous/);
});

test('current system head prefix is validated, omitted from disk and can precede an interior region', async () => {
  const system = text('PRIVATE_CURRENT_SYSTEM', 'system', 'system-id');
  const earlier = text('not selected');
  const chosen = text('selected content');
  const { rows, result, calls } = await archived([[80, system], [7, earlier], [32, chosen]], [structuredClone(system), structuredClone(chosen)]);
  assert.deepEqual(result.eventSeqs, [32]);
  assert.equal(field(rows, 32, 0, 'text'), 'selected content');
  assert.ok(calls.every(call => !call.content.includes('PRIVATE_CURRENT_SYSTEM')));
  await rejectsWithoutWrites([[80, system], [32, chosen]], [text('different system', 'system', 'system-id'), chosen], /match/);
  const noPrefix = await archived([[80, system], [32, chosen]], [chosen]);
  assert.deepEqual(noPrefix.result.eventSeqs, [32]);
});

test('null system head and interior null projections do not prevent matching', async () => {
  const a = text('a'); const b = text('b', 'assistant');
  const { result } = await archived([[30, null], [4, a], [78, null], [2, b]], [a, b]);
  assert.deepEqual(result.eventSeqs, [4, 2]);
});

test('duplicate content is rejected unless the entire sequence or message id resolves it uniquely', async () => {
  const a = text('duplicate');
  await rejectsWithoutWrites([[1, a], [8, structuredClone(a)]], [structuredClone(a)], /ambiguous/);
  const end = text('unique end');
  const matched = await archived([[1, a], [8, structuredClone(a)], [4, end]], [a, end]);
  assert.deepEqual(matched.result.eventSeqs, [8, 4]);
  const x = text('same body', 'user', 'x'); const y = text('same body', 'user', 'y');
  const identified = await archived([[6, x], [2, y]], [structuredClone(y)]);
  assert.deepEqual(identified.result.eventSeqs, [2]);
  await rejectsWithoutWrites([[6, x], [2, structuredClone(x)]], [structuredClone(x)], /ambiguous/);
});

test('same id with changed content, role, source or status is never trusted', async () => {
  const original = { ...text('original', 'tool', 'stable-id'), toolCallId: 'c', isError: false, source: { kind: 'tool', callId: 'c' } };
  for (const changed of [
    { ...original, content: [{ type: 'text', text: 'changed' }] },
    { ...original, role: 'user' },
    { ...original, source: { kind: 'tool', callId: 'wrong' } },
    { ...original, isError: true },
    { ...original, id: 'wrong' },
  ]) await rejectsWithoutWrites([[9, original]], [changed], /match/);
});

test('empty, system-only, developer-only and mismatched inputs reject without storage', async () => {
  const a = text('exists');
  await rejectsWithoutWrites([[1, a]], []);
  await rejectsWithoutWrites([], [a]);
  await rejectsWithoutWrites([[1, a]], [text('absent')]);
  const system = text('private', 'system');
  await rejectsWithoutWrites([[1, system]], [system], /empty/);
  const developer = text('private', 'developer');
  await rejectsWithoutWrites([[1, developer]], [developer], /empty/);
  const { session } = fixture([[1, a]]);
  const { store, calls } = storage();
  await assert.rejects(() => archiveCompactionInput({ input: {}, session, store }), /empty/);
  assert.equal(calls.length, 0);
});

test('private roles still participate in contiguous matching instead of being skipped', async () => {
  const a = text('before'); const dev = text('DO_NOT_WRITE_DEVELOPER', 'developer'); const b = text('after');
  await rejectsWithoutWrites([[1, a], [4, dev], [3, b]], [a, b], /contiguous/);
  const { result, calls } = await archived([[1, a], [4, dev], [3, b]], [a, dev, b]);
  assert.deepEqual(result.eventSeqs, [1, 3]);
  assert.ok(calls.every(call => !call.content.includes('DO_NOT_WRITE_DEVELOPER')));
});

test('only visible projections are exported; raw event bodies, stream, reasoning and replayState never leak', async () => {
  const sys = text('PRIVATE_SYSTEM', 'system');
  const dev = text('PRIVATE_DEVELOPER', 'developer');
  const assistant = {
    ...text('visible answer', 'assistant', 'a'),
    content: [
      { type: 'reasoning', text: 'PRIVATE_REASONING' },
      { type: 'text', text: 'visible answer', extra: 'PRIVATE_BLOCK_EXTRA' },
      { type: 'future-private', text: 'PRIVATE_UNKNOWN_BLOCK' },
    ],
    source: { kind: 'model', provider: 'PRIVATE_PROVIDER', model: 'PRIVATE_MODEL', replayState: { raw: 'PRIVATE_REPLAY' } },
    replayState: 'PRIVATE_TOP_REPLAY', stream: 'PRIVATE_TOP_STREAM', extra: 'PRIVATE_MESSAGE_EXTRA',
  };
  const { calls, result, rows } = await archived([
    [40, sys], [7, dev],
    [6, assistant, { data: { message: text('PRIVATE_RAW_UNPROJECTED'), stream: [{ text: 'PRIVATE_STREAM' }], usage: 'PRIVATE_USAGE', meta: 'PRIVATE_EVENT_META' } }],
  ], [sys, dev, assistant], { tools: [{ name: 'hidden_tool', description: 'PRIVATE_TOOL_SCHEMA', parameters: { secret: 'PRIVATE_SCHEMA' } }] });
  assert.deepEqual(result.eventSeqs, [6]);
  assert.equal(field(rows, 6, 1, 'text'), 'visible answer');
  assert.ok(rows.every(row => row.blockType !== 'reasoning'));
  for (const call of calls) assert.ok(!call.content.includes('PRIVATE_'), call.content);
  assert.ok(!result.footer.includes('PRIVATE_'));
});

test('tool results preserve text, call identity, name and typed error status, not private event errors', async () => {
  const assistant = { role: 'assistant', content: [
    { type: 'tool-call', name: 'read', id: 'call-read', arguments: '{"file_path":"/foo"}' },
    { type: 'tool-call', name: 'edit', id: 'call-edit', arguments: '{"x":1}' },
  ] };
  const good = { ...text('tool output\n'.repeat(100), 'tool'), toolCallId: 'call-read' };
  const bad = { ...text('readable failure', 'tool'), toolCallId: 'call-edit', isError: true };
  const { rows, calls } = await archived([[5, assistant], [8, good], [3, bad, { data: { message: bad, error: { reason: 'PRIVATE_ERROR_DETAIL' }, meta: { raw: 'PRIVATE_TOOL_META' } } }]]);
  assert.equal(field(rows, 8, null, 'toolCallId'), 'call-read');
  assert.equal(field(rows, 8, null, 'toolName'), 'read');
  assert.equal(field(rows, 3, null, 'toolName'), 'edit');
  assert.equal(field(rows, 8, 0, 'text'), good.content[0].text);
  assert.equal(rows.find(row => row.eventSeq === 8 && row.field === 'isError').value, false);
  assert.equal(rows.find(row => row.eventSeq === 3 && row.field === 'isError').value, true);
  assert.match(calls[1].content, /eventSeq: 8 \| role: tool \| jsonlLines: \d+-\d+\ntool: read/);
  assert.match(calls[1].content, /eventSeq: 3 \| role: tool \| jsonlLines: \d+-\d+\ntool: edit/);
  assert.ok(calls.every(call => !call.content.includes('PRIVATE_')));
  assertSchema(rows);
});

test('attachment allowlist preserves references and typed dimensions, never binary or provider fields', async () => {
  const message = { role: 'user', content: [
    { type: 'file', attachment: { attachmentId: 'file-id', name: '/路径/'.repeat(90) + '研究.tex', bytes: 1234, data: 'PRIVATE_FILE_BYTES', locator: 'PRIVATE_UNKNOWN_LOCATOR' }, raw: 'PRIVATE_FILE_RAW' },
    { type: 'image', attachment: { attachmentId: 'image-id', name: '图像😀.png', mediaType: 'image/png', bytes: 42, width: 640, height: 480, originalDimensions: { width: 1280, height: 960, raw: 'PRIVATE_DIMENSIONS_EXTRA' }, base64: 'PRIVATE_BASE64' }, offloaded: true, provider: 'PRIVATE_IMAGE_PROVIDER' },
  ] };
  const { rows, calls } = await archived([[7, message]]);
  assert.equal(field(rows, 7, 0, 'attachment.attachmentId'), 'file-id');
  assert.equal(field(rows, 7, 0, 'attachment.name'), message.content[0].attachment.name);
  assert.equal(field(rows, 7, 1, 'attachment.mediaType'), 'image/png');
  assert.equal(field(rows, 7, 1, 'attachment.name'), '图像😀.png');
  assert.equal(rows.find(row => row.field === 'attachment.originalDimensions.width').value, 1280);
  assert.equal(rows.find(row => row.field === 'attachment.bytes' && row.blockIndex === 0).value, 1234);
  assert.ok(calls.every(call => !call.content.includes('PRIVATE_')));
  assertSchema(rows);
});

test('index provides exact JSONL line ranges and bounds long locator lines; footer keeps full paths', async () => {
  const path = '/actual/' + '长路径😀'.repeat(75) + '/readable.jsonl';
  const indexPath = '/actual/' + '索引'.repeat(110) + '/index.txt';
  const messages = [text('first '.repeat(100)), text('second '.repeat(110), 'assistant')];
  const { calls, rows, result } = await archived([[8, messages[0]], [1, messages[1]]], messages, { storage: { locators: [path, indexPath] } });
  const index = calls[1].content;
  for (const line of index.split('\n')) assert.ok(line.length <= 200);
  assert.ok(index.replaceAll('\n', '').includes(path));
  for (const match of index.matchAll(/^eventSeq: (\d+) \| role: (\w+) \| jsonlLines: (\d+)-(\d+)$/gm)) {
    const [, seq, role, start, end] = match;
    const range = rows.slice(Number(start) - 1, Number(end));
    assert.equal(range[0].kind, 'message');
    assert.ok(range.every(row => row.eventSeq === Number(seq) && row.role === role));
    assert.ok(rows[Number(end)]?.eventSeq !== Number(seq));
  }
  assert.equal([...index.matchAll(/\| jsonlLines: /g)].length, 2);
  assert.ok(result.footer.includes(`历史事件索引: ${indexPath}\n`));
  assert.ok(result.footer.includes(`历史分段原文: ${path}\n`));
});

test('old checkpoint references remain literal body text and never trigger recursive reads', async () => {
  const old = '<compacted-summary>旧结论\n历史事件索引: /old/previous-index.txt\n历史分段原文: /old/previous-readable.jsonl\nsessionId: previous-session</compacted-summary>';
  const { rows, calls, reads } = await archived([[72, text(old)], [9, text('new work')]]);
  assert.equal(field(rows, 72, 0, 'text'), old);
  assert.equal(calls.length, 2);
  assert.deepEqual(reads, [72, 9]);
  assert.ok(calls[0].content.includes('/old/previous-index.txt'));
});

test('input, projected messages, persistent events and surface are immutable', async () => {
  const message = { ...text('unchanged', 'assistant'), source: { kind: 'model', replayState: { nested: [1, 2] } }, content: [{ type: 'reasoning', text: 'private' }, { type: 'text', text: 'unchanged' }] };
  const f = fixture([[9, message]]);
  const input = freeze({ messages: [structuredClone(message)], tools: [{ name: 'read', parameters: {} }] });
  const baseline = structuredClone({ input, events: f.events, surface: f.session.surface, message });
  const s = storage();
  await archiveCompactionInput({ input, session: f.session, store: s.store });
  assert.deepEqual({ input, events: f.events, surface: f.session.surface, message }, baseline);
});

test('footer offers raw event read only when the actual input tools contain it, with no search dependency', async () => {
  const entries = [[1, text('evidence')]];
  for (const tools of [undefined, [], [{ name: 'session_event_search' }], [{ name: 'other', description: 'session_event_read' }]]) {
    const { result } = await archived(entries, undefined, { tools });
    assert.ok(!result.footer.includes('session_event_read'));
    assert.ok(!result.footer.includes('session_event_search'));
  }
  const { result } = await archived(entries, undefined, { tools: [{ name: 'session_event_read' }] });
  assert.match(result.footer, /如仍有 session_event_read 工具/);
  assert.match(result.footer, /session_id.*seq/);
  assert.match(result.footer, /工具不可用时使用上述阅读副本，不改变检索开关/);
});

test('already aborted signal prevents projection and every save', async () => {
  const controller = new AbortController(); controller.abort();
  const f = fixture([[1, text('a')]]); const s = storage();
  await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store, signal: controller.signal }), { name: 'AbortError' });
  assert.deepEqual(f.reads, []);
  assert.equal(s.calls.length, 0);
});

test('abort during either save rejects and never returns a footer or starts a later save', async () => {
  for (const target of [0, 1]) {
    const controller = new AbortController();
    const reason = new Error(`cancel save ${target}`);
    const f = fixture([[1, text('a')]]);
    const s = storage({ beforeReturn(index) { if (index === target) controller.abort(reason); } });
    await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store, signal: controller.signal }), error => error === reason);
    assert.equal(s.calls.length, target + 1);
  }
});

test('abort discovered after projection or while preparing the index prevents the next save', async () => {
  const controller = new AbortController(); const f = fixture([[1, text('a')]]); const s = storage();
  const derive = f.session.deriveEventMessage;
  f.session.deriveEventMessage = event => { const message = derive(event); controller.abort(); return message; };
  await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store, signal: controller.signal }), { name: 'AbortError' });
  assert.equal(s.calls.length, 0);

  const c2 = new AbortController(); const f2 = fixture([[1, text('a')]]); let saves = 0;
  const store = { async saveText() {
    saves += 1;
    let reads = 0;
    return { get locator() { reads += 1; if (reads === 3) c2.abort(); return '/actual/view.jsonl'; } };
  } };
  await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f2.session, store, signal: c2.signal }), { name: 'AbortError' });
  assert.equal(saves, 1);
});

test('storage failure on either save propagates exactly; cancellation after failed save still wins', async () => {
  for (const target of [0, 1]) {
    const failure = new Error(`ENOSPC save ${target}`);
    const f = fixture([[1, text('a')]]);
    const s = storage({ beforeReturn(index) { if (index === target) throw failure; } });
    await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store }), error => error === failure);
    assert.equal(s.calls.length, target + 1);
  }
  const controller = new AbortController();
  const f = fixture([[1, text('a')]]);
  const s = storage({ beforeReturn() { controller.abort(); throw new Error('storage also failed'); } });
  await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store, signal: controller.signal }), { name: 'AbortError' });
});

test('both real nonempty distinct locators are mandatory; suggested names are never used as references', async () => {
  for (const bad of [undefined, null, '', '  \n ', 7]) {
    for (const target of [0, 1]) {
      const locators = ['/actual/view.jsonl', '/actual/index.txt']; locators[target] = bad;
      const f = fixture([[1, text('a')]]); const s = storage({ locators });
      await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store }), /locator/);
      assert.equal(s.calls.length, target + 1);
    }
  }
  const f = fixture([[1, text('a')]]);
  await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: { async saveText() { return undefined; } } }), /locator/);
  const s = storage({ locators: ['/same', '/same'] });
  await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store }), /same locator/);
});

test('invalid surface events, duplicate seqs and projection failures reject without fabricated mappings', async () => {
  await rejectsWithoutWrites([[2, text('a')], [2, text('b')]], [text('a')], /duplicate/);
  await rejectsWithoutWrites([[-1, text('a')]], [text('a')], /invalid/);
  for (const eventAt of [() => undefined, () => ({ seq: 999 })]) {
    const f = fixture([[2, text('a')]]); const s = storage(); f.session.eventAt = eventAt;
    await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store }), /event/);
    assert.equal(s.calls.length, 0);
  }
  const f = fixture([[2, text('a')]]); const s = storage(); const error = new Error('projection failed');
  f.session.deriveEventMessage = () => { throw error; };
  await assert.rejects(() => archiveCompactionInput({ input: { messages: [text('a')] }, session: f.session, store: s.store }), value => value === error);
  assert.equal(s.calls.length, 0);
});
