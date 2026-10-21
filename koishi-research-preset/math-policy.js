import { isDeepStrictEqual } from 'node:util';
import { formatMathResult, readableArtifact } from './math-format.js';

export const MATH_TOOLS = new Set([
  'mcp__mathematica__evaluate_mathematica',
  'mcp__sage__sage_run', 'mcp__sage__sage_verify_checks',
  'mcp__xact__xact_run', 'mcp__xact__xact_verify_residuals',
]);

/** Preserve downstream policy decisions and canonical values. Store success
 * evidence before projecting; errors and unknown/policy-rewritten shapes pass
 * through. A canceled projection never turns cancellation into success. */
export function createMathResultListener(store, { maxInlineChars = 4096, onStorageError = () => {} } = {}) {
  if (!Number.isSafeInteger(maxInlineChars) || maxInlineChars < 256) throw new Error('maxInlineChars must be an integer >= 256.');
  return async function mathResultListener(exec, result, next) {
    const decision = await next();
    if (decision.kind !== 'accept' || Object.hasOwn(decision, 'value') || result.isError || exec.signal.aborted || !exec.agent || !MATH_TOOLS.has(exec.name)) return decision;
    // Do not resurrect content another policy redacted or otherwise replaced.
    if (decision.content !== undefined && !isDeepStrictEqual(decision.content, result.content)) return decision;
    if (!Array.isArray(result.content) || result.content.some(block => block.type !== 'text')) return decision;
    let projected;
    try { projected = formatMathResult(exec.name, result.value, maxInlineChars); }
    catch { return decision; }
    if (!projected) return decision;
    const source = { kind: 'tool', toolName: exec.name, callId: exec.callId, label: 'Research computation evidence' };
    const owner = { sessionId: exec.agent.id };
    const evidence = {
      schemaVersion: 1,
      tool: exec.name,
      callId: exec.callId,
      sessionId: exec.agent.id,
      completeness: 'server-returned',
      upstreamTruncated: projected.upstreamTruncated,
      arguments: exec.arguments,
      received: { value: result.value, content: result.content, ...(result.meta === undefined ? {} : { meta: result.meta }) },
    };
    try {
      if (exec.signal.aborted) return decision;
      const raw = await store.saveText({ owner, source, suggestedName: 'research-result.json', content: JSON.stringify(evidence, null, 2) + '\n' });
      if (exec.signal.aborted) return decision;
      const view = await store.saveText({ owner, source, suggestedName: 'research-result-readable.txt', content: readableArtifact(exec.name, result.value) });
      if (exec.signal.aborted) return decision;
      const references = [
        '',
        '原始数据（服务器实际返回）: ' + raw.locator,
        '分行阅读视图: ' + view.locator,
        raw.retrievalHint,
      ];
      const suffix = '\n' + references.join('\n');
      const fitted = formatMathResult(exec.name, result.value, maxInlineChars - suffix.length);
      if (!fitted) return decision;
      return { ...decision, content: [{ type: 'text', text: fitted.text + suffix }] };
    } catch (error) {
      if (!exec.signal.aborted) onStorageError(error, exec.name);
      return decision;
    }
  };
}
