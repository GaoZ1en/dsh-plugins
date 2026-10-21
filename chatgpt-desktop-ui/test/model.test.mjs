import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { prepareUserMessage, messageTime, copyOriginal } from '../src/model.js';

const root = new URL('../', import.meta.url);
test('preserves Unicode, whitespace, newlines and long text without truncation', () => {
  const text = '  koishi 喵\n\\Omega_{\\Sigma}\t😀' + '长'.repeat(30000);
  const data = Object.freeze({ content: Object.freeze([Object.freeze({ type: 'text', text })]) });
  assert.equal(prepareUserMessage(data).text, text);
});
test('text fragments join exactly as the stock adapter', () => {
  assert.equal(prepareUserMessage({ content: [{ type: 'text', text: 'a ' }, { type: 'text', text: '\nb' }] }).text, 'a \nb');
});
test('keeps image and file attachments in input order without reconstructing their opaque references', () => {
  const a = Object.freeze({ id: 'image-1' }), b = Object.freeze({ id: 'file-1', name: 'note.tex', bytes: 120 });
  const result = prepareUserMessage({ content: [{ type: 'image', attachment: a }, { type: 'text', text: 'between' }, { type: 'file', attachment: b }, { type: 'image', attachment: a }] });
  assert.deepEqual(result.attachments.map(x => x.type), ['image', 'file', 'image']);
  assert.equal(result.attachments[0].image.attachment, a);
  assert.equal(result.attachments[1].file, b);
  assert.equal(result.attachments[2].image.attachment, a);
});
test('retains unknown and malformed blocks for the stock extra-content renderer', () => {
  const blocks = [{ type: 'new-kind', arbitrary: { full: true } }, { type: 'text', text: 7 }, null, { type: 'image' }];
  const result = prepareUserMessage({ content: blocks });
  assert.deepEqual(result.extraBlocks, blocks);
  for (let i = 0; i < blocks.length; i++) assert.equal(result.extraBlocks[i], blocks[i]);
});
test('preserves reference and skill facts without mutating source objects', () => {
  const labels = Object.freeze(['research']), skills = Object.freeze(['note-math-verify']);
  const result = prepareUserMessage(Object.freeze({ content: Object.freeze([]), referenceLabels: labels, skillNames: skills }));
  assert.equal(result.facts.sessionLabels, labels);
  assert.equal(result.facts.skillNames, skills);
  assert.equal(result.referenceLabels, labels);
});
test('empty and attachment-only messages stay valid', () => {
  assert.equal(prepareUserMessage({ content: [] }).text, '');
  assert.equal(prepareUserMessage({ content: [{ type: 'file', attachment: { id: 'file' } }] }).attachments.length, 1);
  assert.throws(() => prepareUserMessage({ content: 'not-a-node' }), TypeError);
});
test('timestamps use the exact recorded instant and reject invalid values', () => {
  assert.equal(messageTime(0, 'en-US').iso, '1970-01-01T00:00:00.000Z');
  for (const invalid of [null, undefined, NaN, Infinity, '0', 1e30]) assert.equal(messageTime(invalid), null);
});
test('message dates follow the selected GUI locale without changing the instant', () => {
  const time = Date.UTC(2026, 9, 20, 13, 0);
  const en = messageTime(time, 'en-US'), zh = messageTime(time, 'zh-CN');
  assert.equal(en.iso, zh.iso);
  assert.notEqual(en.label, zh.label);
});
test('compact timestamps keep full date/time in the tooltip and exact instant in datetime', () => {
  const value = new Date(2026, 9, 20, 22, 55, 54).getTime();
  const result = messageTime(value, 'zh-CN');
  assert.match(result.label, /22:55/);
  assert.doesNotMatch(result.label, /22:55:54/);
  assert.equal(result.title, new Date(value).toLocaleString('zh-CN'));
  assert.equal(result.iso, new Date(value).toISOString());
});
test('empty text never clears the clipboard', async () => {
  let value = 'keep this';
  const clipboard = { async writeText(text) { value = text; } };
  assert.equal(await copyOriginal('', clipboard), false);
  assert.equal(await copyOriginal(undefined, clipboard), false);
  assert.equal(value, 'keep this');
});
test('clipboard waits for success and passes the unmodified original text with its receiver', async () => {
  let settle;
  const clipboard = { value: null, async writeText(text) { this.value = text; await new Promise(resolve => { settle = resolve; }); } };
  let done = false;
  const promise = copyOriginal('  full\n喵', clipboard).then(value => { done = true; return value; });
  await Promise.resolve();
  assert.equal(done, false);
  assert.equal(clipboard.value, '  full\n喵');
  settle();
  assert.equal(await promise, true);
});
test('clipboard rejection and unavailable API never report success', async () => {
  assert.equal(await copyOriginal('x', undefined), false);
  assert.equal(await copyOriginal('x', { writeText() { throw new Error('denied'); } }), false);
  assert.equal(await copyOriginal('x', { async writeText() { throw new Error('denied'); } }), false);
});
test('manifest exports existing runtime and localized original artwork resources', async () => {
  const manifest = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
  assert.equal(manifest.engines.dsh, '0.2.1-rc.2');
  assert.equal(manifest.dsh.bundle.patch, './cordis.patch.yml');
  assert.equal(manifest.dependencies, undefined);
  for (const key of ['.', './client', './icon']) assert.equal((await stat(new URL(manifest.exports[key], root))).isFile(), true);
  for (const locale of ['en', 'zh']) {
    const dict = JSON.parse(await readFile(new URL(`locale/${locale}.json`, root), 'utf8'));
    assert.ok(dict.meta.title.length > 0 && dict.meta.description.length > 0);
  }
  assert.ok((await stat(new URL('icon.svg', root))).size < 256 * 1024);
});
test('client imports only React and does not replace the shell, editor, approvals or host settings', async () => {
  const source = await readFile(new URL('lib/client.js', root), 'utf8');
  assert.deepEqual([...source.matchAll(/require\('([^']+)'\)/g)].map(m => m[1]), ['react']);
  for (const forbidden of ['document.body', 'querySelector', 'localStorage', 'innerHTML', 'setTheme', 'setFontSize', 'Comic Sans', 'PingFang', 'textFontFamily', 'window.__DSH_BOOT__']) assert.equal(source.includes(forbidden), false, forbidden);
  const client = await readFile(new URL('src/client.js', root), 'utf8');
  assert.deepEqual([...client.matchAll(/name: '([^']+)'/g)].map(m => m[1]), ['conversation.chat.node', 'conversation.chat.reasoning.body']);
  assert.ok(client.includes('conversation.chat.user.content'));
  assert.ok(client.includes('conversation.user.text'));
  assert.ok(client.includes("{ text, running }"));
  assert.ok(client.includes('useMessageLocale((snapshot) => snapshot.active)'));
  assert.ok(client.includes('messageTime(node.data?.time, locale)'));
  assert.equal(client.includes('display:none'), false);
  assert.equal(client.includes('JSON.stringify'), false);
  assert.equal(client.includes('original:'), false);
});
test('message actions avoid empty-copy controls and keep feedback outside the action row', async () => {
  const source = await readFile(new URL('src/client.js', root), 'utf8');
  const row = source.match(/\.koishi-cg-actions\{([^}]+)\}/)[1];
  assert.equal(row.includes('flex-wrap'), false);
  assert.ok(source.includes("text !== '' ? h('button'"));
  assert.ok(source.includes("state === 'failed' ? h('div', { className: 'koishi-cg-error', role: 'alert' }"));
  assert.ok(source.includes('title: time.title'));
  assert.ok(source.includes("'aria-label': time.title"));
  assert.ok(source.includes('max-inline-size:min(100%,max(82%,22rem))'));
  assert.equal(source.includes('max-width:600px'), false);
});
