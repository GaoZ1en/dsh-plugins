/** Pure adapter for the inspected 0.2.1-rc.2 Chat user-node currency.
 * Attachment and unknown-block objects remain opaque and retain their order.
 */
export function prepareUserMessage(data) {
  if (!data || !Array.isArray(data.content)) throw new TypeError('Expected Chat user content');
  const texts = [];
  const attachments = [];
  const extraBlocks = [];
  for (const block of data.content) {
    if (block?.type === 'text' && typeof block.text === 'string') texts.push(block.text);
    else if (block?.type === 'image' && block.attachment !== undefined) attachments.push({ type: 'image', image: { attachment: block.attachment } });
    else if (block?.type === 'file' && block.attachment !== undefined) attachments.push({ type: 'file', file: block.attachment });
    else extraBlocks.push(block);
  }
  const facts = {};
  if (data.referenceLabels !== undefined) facts.sessionLabels = data.referenceLabels;
  if (data.skillNames !== undefined) facts.skillNames = data.skillNames;
  return { text: texts.join(''), attachments, extraBlocks, facts, referenceLabels: data.referenceLabels ?? [] };
}

/** Compact local date/time with the exact instant retained for accessibility. */
export function messageTime(value, locale) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  const title = date.toLocaleString(locale);
  const label = new Intl.DateTimeFormat(locale, {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hourCycle: 'h23'
  }).format(date);
  return { iso: date.toISOString(), label, title };
}

/** Clipboard failures remain failures; no success feedback before resolution. */
export async function copyOriginal(text, clipboard) {
  if (typeof text !== 'string' || text === '') return false;
  try {
    if (typeof clipboard?.writeText !== 'function') return false;
    await clipboard.writeText(text);
    return true;
  } catch { return false; }
}
