import { importHostModule } from './host-api.js';
import { buildSummaryRequest, collectSummary, finalizeCheckpoint, splitResearchConfig } from './compaction-core.js';
import { archiveCompactionInput } from './compaction-evidence.js';

export const name = 'koishi-research-compaction';
export const inject = ['loader', 'llm', 'tokenMeter', 'sessions', 'spillStore'];

export async function apply(ctx, config = {}) {
  const { engineConfig, summaryPolicy } = splitResearchConfig(config);
  const [{ BasicCompactionEngine }, { BlockAssembler, LlmError }] = await Promise.all([
    importHostModule(ctx, '@deepseek-ai/dsh-compaction-basic'),
    importHostModule(ctx, '@deepseek-ai/dsh-llm'),
  ]);
  if (![BasicCompactionEngine, BlockAssembler, LlmError].every(value => typeof value === 'function')) throw new Error('The Host lacks the required public compaction/LLM exports.');
  const store = ctx.spillStore;
  if (typeof store?.saveText !== 'function') throw new Error('Research compaction requires its private evidence store.');

  // Only the supported summarizer hook changes. The real Host base class owns
  // transactions, pressure accounting, pairing, retention and overflow recovery.
  class ResearchCompaction extends BasicCompactionEngine {
    async summarize(input, agent, signal) {
      signal?.throwIfAborted();
      // Already inside the official transaction. Failure leaves history intact.
      const { footer } = await archiveCompactionInput({ input, session: agent.session, store, signal });
      const options = buildSummaryRequest(input, agent, this.config, signal, { summaryPolicy, evidenceFooter: footer });
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
      signal?.throwIfAborted();
      // Count the complete custom checkpoint, including both exact locators.
      const checkpoint = finalizeCheckpoint(output, footer, summaryPolicy);
      return { ...checkpoint, llmStreamCall: true, provider: options.provider, model: options.model, maxTokens: options.maxTokens };
    }
  }
  // The inherited Config sees only engine fields. Research-only controls have
  // been separately validated; this child remains owned by the isolated realm.
  await ctx.plugin(ResearchCompaction, engineConfig);
}
