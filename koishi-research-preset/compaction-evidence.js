import { isDeepStrictEqual } from 'node:util';

const CHUNK_SIZE = 200;
const EXPORTED_ROLES = new Set(['user', 'assistant', 'tool']);

function abortIfNeeded(signal) {
  signal?.throwIfAborted();
}

function fail(message) {
  throw new Error(`Research compaction evidence: ${message}`);
}

function sameMessage(left, right) {
  // Identity is only a fast rejection: an unchanged id never licenses changed
  // content (including a changed projection, source, or tool error status).
  if (left?.id !== undefined && right?.id !== undefined && left.id !== right.id) return false;
  return isDeepStrictEqual(left, right);
}

function mapInput(input, session, signal) {
  if (!Array.isArray(input?.messages) || input.messages.length === 0) fail('empty input messages.');
  if (typeof session?.id !== 'string' || !session.id.trim()) fail('missing session id.');
  if (!Array.isArray(session.surface?.nodes)) fail('missing surface nodes.');
  const projected = [];
  const seen = new Set();
  let head;
  for (const [index, seq] of session.surface.nodes.entries()) {
    abortIfNeeded(signal);
    if (!Number.isSafeInteger(seq) || seq < 0 || seen.has(seq)) fail('invalid or duplicate surface seq.');
    seen.add(seq);
    const event = session.eventAt(seq);
    if (!event || event.seq !== seq) fail(`missing or mismatched event at seq ${seq}.`);
    const message = session.deriveEventMessage(event);
    if (message === null) continue;
    if (!message || typeof message !== 'object' || !Array.isArray(message.content)) fail(`invalid projection at seq ${seq}.`);
    const entry = { seq, message };
    projected.push(entry);
    if (index === 0 && event.type === 'system/message' && message.role === 'system') head = message;
  }
  // The official summarizer can prepend exactly the current surface's system
  // head, even when the compacted region starts later. Never strip an arbitrary
  // system message, or filter private roles before checking contiguity.
  const messages = head && sameMessage(input.messages[0], head) ? input.messages.slice(1) : input.messages;
  if (messages.length === 0) fail('empty input region after the system prefix.');
  let match;
  for (let start = 0; start + messages.length <= projected.length; start += 1) {
    abortIfNeeded(signal);
    if (!messages.every((message, index) => sameMessage(message, projected[start + index].message))) continue;
    if (match !== undefined) fail('ambiguous input: more than one contiguous surface match.');
    match = projected.slice(start, start + messages.length);
  }
  if (match === undefined) fail('input does not match a contiguous current surface region.');
  const exported = match.filter(({ message }) => EXPORTED_ROLES.has(message.role));
  if (!exported.length) fail('empty user-visible input region.');
  if (match.some(({ message }) => !EXPORTED_ROLES.has(message.role) && message.role !== 'system' && message.role !== 'developer')) fail('unsupported message role.');
  return exported;
}

// JS string offsets are UTF-16 units. An empty source still gets one chunk so
// absence and an intentionally empty string remain distinguishable.
function splitText(text, size = CHUNK_SIZE) {
  if (typeof text !== 'string') fail('expected a string field.');
  const parts = [];
  for (let start = 0; start < text.length;) {
    let end = Math.min(start + size, text.length);
    const before = text.charCodeAt(end - 1);
    const after = text.charCodeAt(end);
    if (before >= 0xd800 && before <= 0xdbff && after >= 0xdc00 && after <= 0xdfff) end -= 1;
    parts.push(text.slice(start, end));
    start = end;
  }
  return parts.length ? parts : [''];
}

function shortText(text, size = 72) {
  const clean = text.replace(/\s+/gu, ' ').trim();
  return clean.length <= size ? clean : splitText(clean, size - 1)[0] + '…';
}

function renderView(entries, sessionId, signal) {
  const lines = [JSON.stringify({ schemaVersion: 1, kind: 'header', sessionId })];
  const index = [];
  const callNames = new Map();
  const add = row => lines.push(JSON.stringify(row));
  for (const { seq: eventSeq, message } of entries) {
    abortIfNeeded(signal);
    const { role } = message;
    const startLine = lines.length + 1;
    const context = { eventSeq, role };
    add({ kind: 'message', ...context });
    const chunks = (blockIndex, blockType, field, text) => {
      splitText(text).forEach((partText, part) => add({ kind: 'chunk', ...context, blockIndex, blockType, field, part, text: partText }));
    };
    const value = (blockIndex, blockType, field, fieldValue) => {
      add({ kind: 'value', ...context, blockIndex, blockType, field, value: fieldValue });
    };
    const toolNames = [];
    let summary = '';
    if (role === 'tool') {
      chunks(null, 'message', 'toolCallId', message.toolCallId);
      if (message.isError !== undefined && typeof message.isError !== 'boolean') fail('invalid tool error status.');
      value(null, 'message', 'isError', message.isError === true);
      const name = callNames.get(message.toolCallId);
      if (typeof name === 'string') {
        chunks(null, 'message', 'toolName', name);
        toolNames.push(name);
      } else toolNames.push('(unknown)');
    }
    message.content.forEach((block, blockIndex) => {
      if (!block || typeof block !== 'object') fail('invalid content block.');
      const blockType = block.type;
      switch (blockType) {
        case 'text':
          chunks(blockIndex, blockType, 'text', block.text);
          summary ||= shortText(block.text);
          break;
        case 'tool-call': {
          for (const field of ['name', 'id', 'arguments']) chunks(blockIndex, blockType, field, block[field]);
          toolNames.push(block.name);
          summary ||= shortText(block.name);
          // Conflicting repeated call ids must not invent a result's tool name.
          if (!callNames.has(block.id)) callNames.set(block.id, block.name);
          else if (callNames.get(block.id) !== block.name) callNames.set(block.id, null);
          break;
        }
        case 'image':
        case 'file': {
          const ref = block.attachment;
          if (!ref || typeof ref !== 'object') fail('invalid attachment reference.');
          chunks(blockIndex, blockType, 'attachment.attachmentId', ref.attachmentId);
          if (ref.name !== undefined) chunks(blockIndex, blockType, 'attachment.name', ref.name);
          if (blockType === 'image') chunks(blockIndex, blockType, 'attachment.mediaType', ref.mediaType);
          for (const field of blockType === 'image' ? ['bytes', 'width', 'height'] : ['bytes']) {
            if (!Number.isSafeInteger(ref[field]) || ref[field] < 0) fail('invalid numeric attachment reference.');
            value(blockIndex, blockType, `attachment.${field}`, ref[field]);
          }
          if (blockType === 'image' && ref.originalDimensions !== undefined) {
            for (const field of ['width', 'height']) {
              const dimension = ref.originalDimensions?.[field];
              if (!Number.isSafeInteger(dimension) || dimension < 0) fail('invalid original attachment dimensions.');
              value(blockIndex, blockType, `attachment.originalDimensions.${field}`, dimension);
            }
          }
          summary ||= shortText(ref.name ?? `[${blockType}]`);
          break;
        }
        default:
          // Deliberately closed allowlist: reasoning, tool schema updates and
          // future/private block types never enter this reading copy.
          break;
      }
    });
    index.push({ eventSeq, role, toolNames, summary: summary || '(无可导出正文)', startLine, endLine: lines.length });
  }
  return { content: lines.join('\n') + '\n', index };
}

function renderIndex(index, sessionId, viewRef) {
  const lines = [
    'Research compaction evidence v1',
    `sessionId: ${sessionId}`,
    '历史分段原文路径（若折行，直接拼接路径各行，不加分隔符）:',
    ...splitText(viewRef.locator),
    '',
    'JSONL 行号从 1 开始，范围两端均包含；seq 按 surface 顺序列出，不是数值区间。',
    'chunk: 同一 eventSeq/blockIndex/field 的 text 按从 0 开始的 part 拼接，精确还原原字符串。',
    'tool-call arguments 是原始字符串；拼接后可按其原格式 JSON.parse。value 行保留数字/布尔类型。',
    '先 read 本索引，再按行范围 read 副本，小分页如 limit:10。仅含用户可见字段，不是完整原日志。',
    '',
  ];
  for (const entry of index) {
    const names = [...new Set(entry.toolNames)].map(name => shortText(name, 60)).join(', ') || '-';
    lines.push(`eventSeq: ${entry.eventSeq} | role: ${entry.role} | jsonlLines: ${entry.startLine}-${entry.endLine}`);
    lines.push(`tool: ${names} | 摘要: ${entry.summary}`);
  }
  return lines.flatMap(line => splitText(line)).join('\n') + '\n';
}

async function save(store, request, signal) {
  abortIfNeeded(signal);
  let ref;
  try {
    ref = await store.saveText(request);
  } finally {
    // A save can finish (or fail) after cancellation. Never return a successful
    // reference or begin the second write in that case. Partial artifacts may
    // remain: saveText has no public rollback operation.
    abortIfNeeded(signal);
  }
  if (typeof ref?.locator !== 'string' || !ref.locator.trim()) fail('storage returned no locator.');
  return ref;
}

/**
 * Archive only the exact current surface segment supplied to summarize(). The
 * caller already owns the official compaction lock; no log writes or private
 * Session internals are used here. Errors/abort reject rather than fabricate a
 * reference. Returned indexRef/viewRef are the two actual SpillRef values.
 *
 * JSONL v1: header; message markers; chunk rows for strings (<=200 UTF-16 units);
 * value rows for booleans/numbers. blockIndex is the original content index or
 * null for message-level fields. Concatenate each string field by part, not
 * JSONL lines wholesale. Old checkpoint references remain ordinary body text.
 */
export async function archiveCompactionInput({ input, session, store, signal }) {
  abortIfNeeded(signal);
  if (typeof store?.saveText !== 'function') fail('missing saveText store.');
  const entries = mapInput(input, session, signal);
  const view = renderView(entries, session.id, signal);
  const owner = { sessionId: session.id };
  const source = { kind: 'session-reference', sessionId: session.id, label: 'Research compaction evidence' };
  const viewRef = await save(store, { owner, source, suggestedName: 'research-context-readable.jsonl', content: view.content }, signal);
  const indexRef = await save(store, { owner, source, suggestedName: 'research-context-index.txt', content: renderIndex(view.index, session.id, viewRef) }, signal);
  if (indexRef.locator === viewRef.locator) fail('storage returned the same locator for both artifacts.');
  const footer = [
    `历史事件索引: ${indexRef.locator}`,
    `历史分段原文: ${viewRef.locator}`,
    `sessionId: ${session.id}`,
    '以上为机器生成定位。先用 read 读取索引，再按 JSONL 行范围小分页 read 分段原文（例如 limit:10）；同一字段按 part 拼接。',
    ...(Array.isArray(input.tools) && input.tools.some(tool => tool?.name === 'session_event_read')
      ? ['如仍有 session_event_read 工具，可用上述 sessionId 作为 session_id、索引中的 seq 读取对应持久事件；工具不可用时使用上述阅读副本，不改变检索开关。']
      : []),
  ].join('\n');
  abortIfNeeded(signal);
  return { footer, indexRef, viewRef, eventSeqs: entries.map(entry => entry.seq) };
}
