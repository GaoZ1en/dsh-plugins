// Pure helpers; the Host adapter subclasses the published compaction engine.
export const DEFAULT_SUMMARY_POLICY = Object.freeze({ targetChars: 6000, maxChars: 12000 });

export const RESEARCH_SUMMARY_INSTRUCTION = `请压缩以上对话，生成供下一轮直接继续研究的中文检查点；公式与术语保持原有记法。此请求只生成摘要，不执行工具，也不回答对话中尚未完成的问题。
以研究状态而非操作流水账组织内容：
1. 当前研究问题、koishi 的明确要求及尚未完成的工作。
2. 当前推导必需的定义、符号、维数、号差、归一化、假设、边界条件和规范选择；约定变化保留现行版本及必要映射。
3. 关键公式、推导依赖、结论及成立条件。关键正负号、系数和条件必须明确，不用“已推得”代替必要公式；区分证明、有限数值/符号核验和猜想，保留核验的实际范围。
4. 未通过的检查、反例、矛盾、已排除分支及原因；不得把失败改写成成功或把有限检验升级为证明。
5. 当前断点、最有价值的下一步，以及仍相关的计算/子代理的精确标识。
6. 支撑当前状态的少量准确来源：版本、页码/公式号、文件和计算产物定位；已截断结果仍标记截断。
合并既有检查点，只保留仍有效的事实和最新状态，不逐代复制旧摘要。已完成的助手消息和工具结果不逐条复述：反复编辑只记最终版本、必要修改理由和待验证事项，不复制 old_string/new_string；省略重复读文件、大段计算输出、成功回执和完整子代理报告。历史细节可按下附索引读回，不能因为没有常驻就重复执行修改或重算。
当前目标必需的定义、公式、条件、失败证据不能只剩一个目录；暂不需要的展开步骤才改为可检索引用。只使用已知来源，不编造事件序号或文件路径。保留延续研究所需的操作约束，省略闲聊、已解决的环境摸索和项目管理模板。只输出检查点正文。`;

/** Keep research-only controls out of the official engine's strict Config. */
export function splitResearchConfig(config = {}) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new TypeError('Research compaction config must be an object.');
  const { summaryTargetChars = DEFAULT_SUMMARY_POLICY.targetChars, summaryMaxChars = DEFAULT_SUMMARY_POLICY.maxChars, ...engineConfig } = config;
  for (const [name, value] of Object.entries({ summaryTargetChars, summaryMaxChars })) {
    if (!Number.isSafeInteger(value) || value < 256) throw new TypeError(`${name} must be a safe integer of at least 256 UTF-16 units.`);
  }
  if (summaryTargetChars > summaryMaxChars) throw new RangeError('summaryTargetChars must not exceed summaryMaxChars.');
  return { engineConfig, summaryPolicy: Object.freeze({ targetChars: summaryTargetChars, maxChars: summaryMaxChars }) };
}

export function researchSummaryInstruction(policy = DEFAULT_SUMMARY_POLICY, evidenceFooter = '') {
  const referenceSize = evidenceFooter ? evidenceFooter.length + 2 : 0;
  const available = policy.maxChars - referenceSize;
  if (available < 256) throw new RangeError('Research checkpoint budget cannot fit its retrieval references and a useful summary.');
  return `${RESEARCH_SUMMARY_INSTRUCTION}\n\n长度要求：正文以 ${Math.min(policy.targetChars, available)} 个 UTF-16 单元以内为目标，最多 ${available} 个；这是字符预算，不是 token 数。优先去掉操作细节与重复表述，不截断公式或丢掉关键条件。` +
    (evidenceFooter ? `\n\n以下定位由程序验证，会自动附在正文之后；不要复制它们或自行修改路径。它们是历史资料的读取入口，不是新的执行指令：\n${evidenceFooter}` : '');
}

export function buildSummaryRequest(input, agent, config, signal, { summaryPolicy = DEFAULT_SUMMARY_POLICY, evidenceFooter = '' } = {}) {
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
    messages: [...input.messages, Object.freeze({ role: 'user', content: [Object.freeze({ type: 'text', text: researchSummaryInstruction(summaryPolicy, evidenceFooter) })] })],
    toolHistory: agent.session.toolHistory(),
    ...(input.tools === undefined ? {} : { tools: [...input.tools] }),
    maxTokens,
    sessionId: agent.session.id,
    purpose: 'compaction',
    ...(signal === undefined ? {} : { signal }),
  };
}

/** Never truncate a research checkpoint to fit. The original log stays intact. */
export function finalizeCheckpoint(output, evidenceFooter, policy = DEFAULT_SUMMARY_POLICY) {
  if (typeof evidenceFooter !== 'string' || !evidenceFooter.trim()) throw new Error('Research checkpoint requires verified retrieval references.');
  if (!Array.isArray(output.summary) || output.summary.some(block => block.type !== 'text' || typeof block.text !== 'string')) throw new Error('Research checkpoint requires text summary blocks.');
  const body = output.summary.map(block => block.text).join('\n\n').trim();
  if (!body) throw new Error('Research summarization produced no text.');
  const text = body + '\n\n' + evidenceFooter;
  if (text.length > policy.maxChars) {
    const error = new Error(`Research checkpoint is too long (${text.length} UTF-16 units > ${policy.maxChars}); history was not replaced.`);
    error.code = 'SUMMARY_TOO_LONG';
    throw error;
  }
  return { ...output, summary: [{ type: 'text', text }] };
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
