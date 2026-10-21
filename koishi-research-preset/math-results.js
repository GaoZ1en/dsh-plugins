import { createMathResultListener } from './math-policy.js';

export const name = 'koishi-research-math-results';
export const inject = ['tools', 'spillStore'];

export function apply(ctx, config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config) || Object.keys(config).some(key => key !== 'maxInlineChars')) throw new TypeError('Research math-result config accepts only maxInlineChars.');
  ctx.on('tools/post-execute', createMathResultListener(ctx.spillStore, {
    maxInlineChars: config.maxInlineChars ?? 4096,
    onStorageError: (_error, tool) => ctx.logger.warn(`Research evidence storage failed for ${tool}; preserving the original tool response.`),
  }));
}
