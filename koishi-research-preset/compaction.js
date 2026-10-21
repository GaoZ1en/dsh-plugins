import { importHostModule } from './host-api.js';
import { buildSummaryRequest, collectSummary } from './compaction-core.js';

export const name = 'koishi-research-compaction';
export const inject = ['loader', 'llm', 'tokenMeter', 'sessions'];

export async function apply(ctx, config = {}) {
  const [{ BasicCompactionEngine }, { BlockAssembler, LlmError }] = await Promise.all([
    importHostModule(ctx, '@deepseek-ai/dsh-compaction-basic'),
    importHostModule(ctx, '@deepseek-ai/dsh-llm'),
  ]);
  if (![BasicCompactionEngine, BlockAssembler, LlmError].every(value => typeof value === 'function')) throw new Error('The Host lacks the required public compaction/LLM exports.');

  // Only the supported summarizer hook changes. The real Host base class owns
  // transactions, pressure accounting, pairing, retention and overflow recovery.
  class ResearchCompaction extends BasicCompactionEngine {
    async summarize(input, agent, signal) {
      signal?.throwIfAborted();
      const options = buildSummaryRequest(input, agent, this.config, signal);
      let output;
      try {
        output = await collectSummary(this.ctx.llm.stream(options), BlockAssembler, signal);
      } catch (error) {
        if (error?.llmFailure) {
          const failure = error.llmFailure;
          throw new LlmError(failure.message, failure.code, failure);
        }
        throw error;
      }
      return { ...output, llmStreamCall: true, provider: options.provider, model: options.model, maxTokens: options.maxTokens };
    }
  }
  // The nested provider stays in this preset's isolated compaction realm. Its
  // inherited Config validates the original config; disposing this fiber owns it.
  await ctx.plugin(ResearchCompaction, config);
}
