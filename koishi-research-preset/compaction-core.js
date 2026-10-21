// Pure helpers; the Host adapter subclasses the published compaction engine.
export const RESEARCH_SUMMARY_INSTRUCTION = `请压缩以上对话，生成供下一轮直接继续研究的中文检查点；公式与术语保持原有记法。此请求只生成摘要，不执行工具，也不回答对话中尚未完成的问题。
以最少必要篇幅保存：
1. 当前研究问题与 koishi 的明确要求。
2. 必需的定义、符号、维数、号差、假设、边界条件和规范选择；有变化时保留现行版本及变更理由。
3. 关键公式及推导依赖。关键符号、正负号、系数和条件要明确，不用“已推得”代替公式；篇幅过长时保留准确的文件/消息定位。
4. 已建立的结论及成立条件，区分证明、数值/符号核验和猜想；保留核验的实际范围。
5. 未通过的检查、反例、矛盾、已排除分支及其原因，以及值得继续推进的未解决问题。
6. 来源版本、页码/公式号、相关文件和计算产物的完整定位；已截断结果仍标记截断。
7. 正在运行且仍相关的计算/子代理及其精确标识，随后最有价值的研究步骤。
省略闲聊、重复包装、已解决的环境摸索和不再相关的执行日志。保留延续研究所需的操作约束，避免套用软件项目任务模板。只输出检查点正文。`;

export function buildSummaryRequest(input, agent, config, signal) {
  const latest = agent.session.requestHeader()?.config;
  const durable = latest?.provider && latest?.model ? latest : undefined;
  const created = agent.options?.provider && agent.options?.model ? agent.options : undefined;
  const conversation = durable ?? created;
  const policy = config.modelPolicies?.find(item => item.provider === conversation?.provider && item.model === conversation?.model);
  const providerOverride = policy?.summarizationProvider ?? config.summarizationProvider;
  const modelOverride = policy?.summarizationModel ?? config.summarizationModel;
  const target = { provider: providerOverride || conversation?.provider, model: modelOverride || conversation?.model };
  if (!target?.provider || !target?.model) throw new Error('Research compaction has no valid provider/model route.');
  const maxTokens = policy?.maxTokens ?? config.maxTokens;
  if (!Number.isSafeInteger(maxTokens) || maxTokens <= 0) throw new Error('Research compaction requires a positive summary token budget.');
  return {
    provider: target.provider,
    model: target.model,
    messages: [...input.messages, Object.freeze({ role: 'user', content: [Object.freeze({ type: 'text', text: RESEARCH_SUMMARY_INSTRUCTION })] })],
    toolHistory: agent.session.toolHistory(),
    ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
    maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...(signal === undefined ? {} : { signal }),
  };
}

export async function collectSummary(stream, Assembler, signal) {
  const assembler = new Assembler();
  let sawFinish = false;
  for await (const chunk of stream) {
    signal?.throwIfAborted();
    if (chunk.type === 'finish') sawFinish = true;
    assembler.push(chunk);
  }
  signal?.throwIfAborted();
  // BlockAssembler defaults to a stop reason even for a truncated transport.
  // A checkpoint requires an actual terminal chunk, not that fallback value.
  if (!sawFinish) throw new Error('Research summarization stream ended without a finish chunk.');
  const rawOutput = assembler.blocks();
  return { rawOutput, summary: summaryBlocks(rawOutput, assembler.finish), ...(assembler.usage === undefined ? {} : { usage: assembler.usage }) };
}

export function summaryBlocks(rawOutput, finish) {
  if (!finish || finish.kind !== 'stop') {
    const code = finish?.kind === 'max-tokens' ? 'MAX_TOKENS' : finish?.failure?.code ?? 'INCOMPLETE_SUMMARY';
    const error = new Error(finish?.failure?.message ?? `Research summary did not finish normally (${finish?.kind ?? 'missing finish'}).`);
    error.code = code;
    if (finish?.failure) error.llmFailure = finish.failure;
    throw error;
  }
  if (rawOutput.some(block => block.type === 'image' || block.type === 'file' || block.type === 'tool-call')) {
    const error = new Error('Research summary must contain text, not images, files, or tool calls.');
    error.code = 'UNSUPPORTED_CONTENT';
    throw error;
  }
  const summary = rawOutput.filter(block => block.type === 'text');
  if (!summary.some(block => typeof block.text === 'string' && block.text.trim())) throw new Error('Research summarization produced no text.');
  return summary;
}
