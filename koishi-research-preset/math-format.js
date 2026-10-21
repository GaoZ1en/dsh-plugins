// Pure display projections. The Host must archive the unmodified canonical result.
const TOOLS = new Map([
  ['sage_run', { format: 'sage', mode: 'run' }],
  ['sage_verify_checks', { format: 'sage', mode: 'verify' }],
  ['xact_run', { format: 'xact', mode: 'run' }],
  ['xact_verify_residuals', { format: 'xact', mode: 'verify' }],
  ['evaluate_mathematica', { format: 'mathematica', mode: 'run' }],
]);
const SAGE_STATUSES = ['error', 'non_boolean', 'failed', 'passed'];
const XACT_STATUSES = ['error', 'unevaluated', 'nonzero_normal_form', 'zero'];
const STATUS_ORDER = ['error', 'non_boolean', 'unevaluated', 'nonzero_normal_form', 'failed', 'passed', 'zero'];
const FIELD_ORDER = [
  'profile', 'pipeline', 'pipelineSteps', 'assumptions',
  'error', 'setupError', 'loadErrors', 'loadMessages', 'setupMessages', 'messages',
  'warnings', 'category', 'type', 'message', 'traceback', 'transportStderr',
  'result', 'resultType', 'value', 'valueType', 'canonicalResidual', 'finalResidual',
  'unknownHeads', 'stdout', 'stderr', 'loadedPackages', 'elapsedMs',
];
const MATH_PREFIX = 'Mathematica code executed:\n```wl\n';
const MATH_MARKER = '\n```\n\nOutput:\n';
const MIN_VALUE_BUDGET = 48;

const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const flag = key => key === 'truncated' || key.endsWith('Truncated');
const metadata = key => /sha(?:-?(?:1|224|256|384|512))?$/i.test(key)
  || /^(?:sageVersion|wolframVersion|mathematicaVersion|xactVersion|kernelVersion|versions)$/i.test(key);
const nonempty = value => value !== null && value !== undefined && value !== ''
  && (!Array.isArray(value) || value.length > 0)
  && (!record(value) || Object.keys(value).length > 0);

function toolInfo(toolName) {
  if (typeof toolName !== 'string') return null;
  // Match a complete tool basename, not substrings such as "not_sage_run".
  const name = toolName.startsWith('functions.') ? toolName.slice(10) : toolName;
  const basename = name.startsWith('mcp__') ? name.slice(name.lastIndexOf('__') + 2) : name;
  return TOOLS.get(basename) ?? null;
}

function isJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  ancestors.add(value);
  const valid = Object.values(value).every(item => isJson(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function sameJson(left, right) {
  if (left === right) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length
    && keys.every(key => own(right, key) && sameJson(left[key], right[key]));
}

function canonicalText(canonical) {
  if (!record(canonical) || !isJson(canonical) || !Array.isArray(canonical.content)
      || canonical.content.length === 0
      || canonical.content.some(item => !record(item) || item.type !== 'text' || typeof item.text !== 'string')
      || (own(canonical, 'isError') && typeof canonical.isError !== 'boolean')
      || (own(canonical, 'structuredContent') && !record(canonical.structuredContent))) return null;
  return canonical.content.map(item => item.text);
}

function parseJson(text) {
  try { return { parsed: true, value: JSON.parse(text) }; }
  catch { return { parsed: false }; }
}

function payloadFrom(canonical, texts) {
  if (!own(canonical, 'structuredContent')) {
    if (texts.length !== 1) return null;
    const parsed = parseJson(texts[0]);
    return parsed.parsed && record(parsed.value) ? { payload: parsed.value, extraTexts: [] } : null;
  }
  const payload = canonical.structuredContent;
  const extraTexts = [];
  for (const [index, text] of texts.entries()) {
    if (text === '') continue;
    const parsed = parseJson(text);
    // Conflicting machine-readable versions must pass through untouched.
    if (parsed.parsed) {
      if (!sameJson(parsed.value, payload)) return null;
    } else {
      // Supplemental textual diagnostics are not duplicates of structuredContent.
      extraTexts.push({ label: `MCP text[${index + 1}]`, value: text });
    }
  }
  return { payload, extraTexts };
}

function validFlags(value) {
  if (!value || typeof value !== 'object') return true;
  return Object.entries(value).every(([key, item]) => (!flag(key) || typeof item === 'boolean') && validFlags(item));
}

function validPayload(info, payload) {
  if (typeof payload.ok !== 'boolean' || !validFlags(payload)) return false;
  if (info.format === 'sage' && payload.mode !== info.mode) return false;
  if (info.format === 'xact' && (typeof payload.profile !== 'string' || payload.profile === '')) return false;
  for (const key of ['allPassed', 'allZero']) {
    if (own(payload, key) && typeof payload[key] !== 'boolean') return false;
  }
  for (const key of ['stdout', 'stderr', 'resultType', 'pipeline', 'assumptions']) {
    if (own(payload, key) && typeof payload[key] !== 'string') return false;
  }
  for (const key of ['warnings', 'messages', 'loadErrors', 'loadMessages', 'setupMessages', 'transportStderr', 'loadedPackages', 'pipelineSteps']) {
    if (own(payload, key) && !Array.isArray(payload[key])) return false;
  }
  if (own(payload, 'result') && payload.result !== null && typeof payload.result !== 'string') return false;
  if (info.mode === 'run') {
    return !own(payload, 'checks') && (own(payload, 'result') || (!payload.ok
      && ['error', 'setupError', 'loadErrors', 'messages', 'transportStderr'].some(key => nonempty(payload[key]))));
  }
  if (!Array.isArray(payload.checks)) return false;
  if (info.format === 'xact' && typeof payload.pipeline !== 'string') return false;
  const statuses = info.format === 'sage' ? SAGE_STATUSES : XACT_STATUSES;
  return payload.checks.every(check => record(check) && typeof check.label === 'string'
    && statuses.includes(check.status)
    && ['value', 'valueType', 'canonicalResidual', 'finalResidual'].every(key => !own(check, key) || typeof check[key] === 'string')
    && ['messages', 'unknownHeads'].every(key => !own(check, key) || Array.isArray(check[key])));
}

function hasUpstreamTruncation(value) {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, item]) => (flag(key) && item === true) || hasUpstreamTruncation(item));
}

function orderedKeys(value) {
  const rank = key => {
    const index = FIELD_ORDER.indexOf(key);
    return index < 0 ? FIELD_ORDER.length : index;
  };
  return Object.keys(value).sort((a, b) => rank(a) - rank(b) || (a < b ? -1 : a > b ? 1 : 0));
}

function fieldName(key) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(key) ? key : JSON.stringify(key);
}

// Flatten fields, not messages: every nonempty diagnostic retains its own label.
function atomsFor(value, path = '', omit = new Set()) {
  if (!nonempty(value)) return [];
  if (Array.isArray(value)) return value.flatMap((item, index) => atomsFor(item, `${path}[${index + 1}]`));
  if (!record(value)) return [{ label: path, value: String(value) }];
  return orderedKeys(value).flatMap(key => {
    if (omit.has(key) || metadata(key) || (flag(key) && value[key] === false)) return [];
    const label = path ? `${path}.${fieldName(key)}` : fieldName(key);
    return atomsFor(value[key], label);
  });
}

function mathOutput(text) {
  if (!text.startsWith(MATH_PREFIX)) return null;
  const index = text.lastIndexOf(MATH_MARKER);
  // A marker inside either code or actual output makes the boundary ambiguous.
  if (index < MATH_PREFIX.length || text.indexOf(MATH_MARKER, MATH_PREFIX.length) !== index) return null;
  return text.slice(index + MATH_MARKER.length);
}

function modelFor(toolName, canonical) {
  const info = toolInfo(toolName);
  if (!info) return null;
  const texts = canonicalText(canonical);
  if (!texts) return null;
  const transport = canonical.isError === true ? '; MCP isError=true' : '';
  if (info.format === 'mathematica') {
    if (texts.length !== 1 || own(canonical, 'structuredContent')) return null;
    const output = mathOutput(texts[0]);
    if (output === null) return null;
    return {
      format: info.format, upstreamTruncated: false,
      header: `Mathematica output${transport}`,
      atoms: [{ label: '', value: output }], rows: [],
    };
  }
  const parsed = payloadFrom(canonical, texts);
  if (!parsed || !validPayload(info, parsed.payload)) return null;
  const { payload, extraTexts } = parsed;
  const upstreamTruncated = hasUpstreamTruncation(payload);
  const controls = ['allPassed', 'allZero'].filter(key => own(payload, key)).map(key => `; ${key}=${payload[key]}`).join('');
  const rows = (payload.checks ?? []).map((check, index) => ({
    index, label: check.label, status: check.status,
    diagnostic: ['error', 'warnings', 'messages', 'unknownHeads'].some(key => nonempty(check[key])),
    atoms: atomsFor(check, '', new Set(['label', 'status'])),
  }));
  let header = `${info.format === 'sage' ? 'Sage' : 'xAct'} ${info.mode}; ok=${payload.ok}${controls}${transport}`;
  if (info.format === 'xact' && info.mode === 'verify') header += '\nStatuses are kernel outcomes, not mathematical truth judgments.';
  if (upstreamTruncated) header += '\nUpstream truncated: true (the archived response is also incomplete).';
  if (info.mode === 'verify') {
    const counts = STATUS_ORDER.map(status => {
      const count = rows.filter(row => row.status === status).length;
      return count ? `${status}=${count}` : '';
    }).filter(Boolean);
    header += `\nChecks: ${rows.length}${counts.length ? ` (${counts.join(', ')})` : ''}`;
  }
  return {
    format: info.format, upstreamTruncated, header, rows,
    atoms: [...atomsFor(payload, '', new Set(['mode', 'ok', 'allPassed', 'allZero', 'checks'])), ...extraTexts],
  };
}

function safePrefix(text, length) {
  let end = Math.max(0, Math.min(length, text.length));
  const previous = text.charCodeAt(end - 1);
  const next = text.charCodeAt(end);
  if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) end--;
  return text.slice(0, end);
}

function clipped(text, limit) {
  if (text.length <= limit) return text;
  const marker = omitted => `… [display omitted ${omitted} chars]`;
  // Reserve the longest possible count, then report the exact excluded UTF-16 units.
  const prefix = safePrefix(text, limit - marker(text.length).length);
  return prefix + marker(text.length - prefix.length);
}

function renderAtom(atom, limit, indent = '') {
  const value = clipped(atom.value, limit);
  const label = atom.label ? `${atom.label}: ` : '';
  if (!label && !indent) return value;
  return indent + label + value.replace(/\n/g, `\n${indent}  `);
}

function renderRow(row, limit) {
  const label = clipped(row.label, limit).replace(/\n/g, '\n  ');
  return [`[${row.index + 1}] ${label}: ${row.status}`, ...row.atoms.map(atom => renderAtom(atom, limit, '  '))].join('\n');
}

function render(model, rows, limit) {
  const parts = [model.header, ...model.atoms.map(atom => renderAtom(atom, limit)), ...rows.map(row => renderRow(row, limit))];
  const omitted = model.rows.length - rows.length;
  if (omitted) parts.push(`Display omitted: ${omitted} of ${model.rows.length} checks.`);
  return parts.join('\n');
}

function representativeOrder(rows) {
  const rank = row => row.status === 'error' ? 0
    : row.diagnostic && ['passed', 'zero'].includes(row.status) ? 0.5
      : STATUS_ORDER.indexOf(row.status) + 1;
  const sorted = [...rows].sort((a, b) => rank(a) - rank(b) || a.index - b.index);
  const seen = new Set();
  const first = [];
  const rest = [];
  for (const row of sorted) {
    const key = `${row.status}:${row.diagnostic}`;
    (seen.has(key) ? rest : first).push(row);
    seen.add(key);
  }
  return [...first, ...rest];
}

/**
 * Compact only the five known MCP tools and recognized canonical payloads.
 * `omitted` counts whole check rows; shortened values explicitly report their
 * display-only character omissions. Upstream truncation is independent.
 * Budgets count UTF-16 units (String.length), never split surrogate pairs, and
 * exclude any artifact locator the caller adds. A budget too small to retain
 * required context/diagnostic labels returns null for safe original passthrough.
 * This function never changes canonical, content, structuredContent, or isError.
 */
export function formatMathResult(toolName, canonical, maxInlineChars = 4096) {
  if (!Number.isSafeInteger(maxInlineChars) || maxInlineChars < 0) return null;
  try {
    const model = modelFor(toolName, canonical);
    if (!model) return null;
    const full = render(model, model.rows, Infinity);
    if (full.length <= maxInlineChars) return { text: full, upstreamTruncated: model.upstreamTruncated, format: model.format, omitted: 0 };
    let selected = model.rows;
    if (render(model, selected, MIN_VALUE_BUDGET).length > maxInlineChars) {
      selected = [];
      if (render(model, selected, MIN_VALUE_BUDGET).length > maxInlineChars) return null;
      for (const row of representativeOrder(model.rows)) {
        const next = [...selected, row].sort((a, b) => a.index - b.index);
        if (render(model, next, MIN_VALUE_BUDGET).length <= maxInlineChars) selected = next;
      }
    }
    // Share the remaining space among values instead of letting the first giant
    // result or traceback silently erase later warnings and check outcomes.
    let low = MIN_VALUE_BUDGET;
    let high = maxInlineChars;
    while (low < high) {
      const mid = Math.ceil((low + high) / 2);
      if (render(model, selected, mid).length <= maxInlineChars) low = mid;
      else high = mid - 1;
    }
    const text = render(model, selected, low);
    return { text, upstreamTruncated: model.upstreamTruncated, format: model.format, omitted: model.rows.length - selected.length };
  } catch {
    // Malformed/non-JSON inputs must not turn a display optimization into failure.
    return null;
  }
}

function wrapLines(text, width = 1000) {
  return text.split('\n').flatMap(line => {
    const parts = [];
    let rest = line;
    while (rest.length > width) {
      const part = safePrefix(rest, width);
      parts.push(part);
      rest = rest.slice(part.length);
    }
    parts.push(rest);
    return parts;
  }).join('\n');
}

/** A complete, decoded readable view; the separate canonical JSON is authoritative. */
export function readableArtifact(toolName, canonical) {
  let body;
  try {
    const model = modelFor(toolName, canonical);
    if (model) body = render(model, model.rows, Infinity);
    else {
      // Unknown shapes are rendered without metadata filtering or interpretation.
      body = JSON.stringify(canonical, null, 2) ?? String(canonical);
    }
  } catch {
    body = '[Cannot render non-JSON canonical input.]';
  }
  return wrapLines(`Tool: ${String(toolName)}\nReadable view; exact canonical JSON is archived separately.\n\n${body}`);
}
