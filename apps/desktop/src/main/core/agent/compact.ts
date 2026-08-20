import type { ResolvedModel } from '../models/runtime';
import { defaultKeepRecentTokens, resolveCompactionCutPoint } from '../sessions/compaction-cut';
import type { SessionMessage } from '../sessions/entry';
import type { SessionStore } from '../sessions/store';
import { estimateMessagesTokens } from '../sessions/token-estimate';

export type CompactReason = 'manual' | 'threshold' | 'overflow';

/** 交给摘要生产者的折叠区间与预算。 */
export type CompactSummaryInput = {
  sessionId: string;
  /** 会话创建时绑定的工作区，不能在压缩时改读全局 currentCwd。 */
  cwd: string;
  reason: CompactReason;
  /** 首条保留 entry；同时作为检查点幂等标识。 */
  checkpointId: string;
  tokensBefore: number;
  /** 将被折叠的对话正文。 */
  conversation: string;
  /** 上一轮生效摘要；必须一并折入，否则它承载的历史会丢。 */
  previousSummary?: string;
  /** 按当前模型窗口扣除输出与协议开销后的输入预算。 */
  maxInputTokens: number;
  signal?: AbortSignal;
};

export type CompactSummary = {
  summary: string;
  /** 检查点落盘引用（workspace 相对路径）。 */
  summaryRef?: string;
  /** 蒸馏任务 runId。 */
  runId?: string;
  memoryRefs?: string[];
};

/**
 * 摘要生产者端口。
 *
 * **必填，且有意不提供兜底实现**：装配层注入的是创作检查点管线
 * （`features/memory/compaction`），它先把检查点原子落盘、失败即抛，
 * 压缩才继续。留一个"就地 generateText"的降级路径会让接线断掉时无人察觉，
 * 而模块内部的单测一条都不会因此变红。
 */
export type CompactSummarizer = (input: CompactSummaryInput) => Promise<CompactSummary>;

export type CompactOptions = {
  /**
   * 会话标识：检查点文件名与 parentSessionId 的键。
   *
   * 由调用方传入而不是读 `store.header.id`：会话身份归仓储管（文件名即 id），
   * store 只负责单个文件的读写，不该成为这个键的事实源。
   */
  sessionId: string;
  model: ResolvedModel;
  store: SessionStore;
  summarize: CompactSummarizer;
  /** 触发来源；当前仅手动，阈值与溢出触发待接。 */
  reason?: CompactReason;
  /** 保留近期原文的 token 预算；缺省按模型窗口推导。 */
  keepRecentTokens?: number;
  /** 摘要生产者的输入预算；缺省按模型窗口推导。 */
  maxInputTokens?: number;
  abortSignal?: AbortSignal;
};

export type CompactResult = {
  summary: string;
  summaryRef?: string;
  runId?: string;
  memoryRefs?: string[];
  tokensBefore: number;
  estimatedTokensAfter: number;
  firstKeptEntryId: string;
};

/**
 * 会话压缩：求切点 → 折叠区间交摘要生产者 → appendCompaction 落流。
 *
 * 顺序是契约的一部分：检查点必须先于会话流落盘，**落盘失败即取消压缩**。
 * 因此摘要生产者若抛错，本函数不写任何 entry——会话保持原样，用户重试即可。
 */
export async function compactSession(options: CompactOptions): Promise<CompactResult> {
  const { sessionId, model, store, summarize, reason = 'manual', abortSignal } = options;

  const projection = store.buildContextProjection();

  if (projection.entries.length === 0) {
    throw new Error('会话没有可压缩的上下文');
  }

  const cut = resolveCompactionCutPoint(
    projection.entries,
    options.keepRecentTokens ?? defaultKeepRecentTokens(model.contextWindow)
  );

  if (!cut) {
    throw new Error('当前会话内容还不足以压缩');
  }

  const tokensBefore = estimateMessagesTokens(store.buildContextMessages());
  // 只把将被折叠的部分交出去：切点之后的原文会逐字保留，重复送去总结既费 token，
  // 又会让摘要复述紧挨在它下面的正文。
  const conversation = projection.entries
    .slice(0, cut.foldedCount)
    .map(entry => formatForTranscript(entry.message))
    .join('\n\n');

  const produced = await summarize({
    sessionId,
    cwd: store.header.cwd,
    reason,
    checkpointId: cut.firstKeptEntryId,
    tokensBefore,
    conversation,
    ...(projection.summary ? { previousSummary: projection.summary } : {}),
    maxInputTokens: options.maxInputTokens ?? defaultCompactInputTokens(model.contextWindow),
    ...(abortSignal ? { signal: abortSignal } : {})
  });

  const summary = produced.summary.trim();

  if (!summary) {
    throw new Error('压缩结果为空');
  }

  await store.appendCompaction(summary, cut.firstKeptEntryId, tokensBefore, {
    reason,
    ...(produced.summaryRef ? { summaryRef: produced.summaryRef } : {}),
    ...(produced.runId ? { distillerRunId: produced.runId } : {}),
    ...(produced.memoryRefs ? { memoryRefs: produced.memoryRefs } : {})
  });

  return {
    summary,
    ...(produced.summaryRef ? { summaryRef: produced.summaryRef } : {}),
    ...(produced.runId ? { runId: produced.runId } : {}),
    ...(produced.memoryRefs ? { memoryRefs: produced.memoryRefs } : {}),
    tokensBefore,
    estimatedTokensAfter: estimateMessagesTokens([
      { role: 'user', content: summary },
      ...projection.entries.slice(cut.foldedCount).map(entry => entry.message)
    ]),
    firstKeptEntryId: cut.firstKeptEntryId
  };
}

/** 摘要生产者的输入预算：给它自己的输出与 persona 提示词留出余量。 */
export function defaultCompactInputTokens(contextWindow: number): number {
  return contextWindow > 0 ? Math.max(2_000, Math.floor(contextWindow * 0.6)) : 24_000;
}

/** 折叠区间 → 交给摘要生产者的纯文本；工具结果带上工具名，便于摘要保留出处。 */
function formatForTranscript(message: SessionMessage): string {
  const prefix =
    message.role === 'user'
      ? '用户'
      : message.role === 'assistant'
        ? '助手'
        : message.role === 'tool'
          ? '工具'
          : '系统';

  const body =
    message.role === 'tool'
      ? `（${message.toolName}）${stringify(message.output)}`
      : typeof message.content === 'string'
        ? message.content
        : stringify(message.content);

  return `${prefix}：${body}`;
}

function stringify(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value ?? '') ?? '';
  } catch {
    return String(value);
  }
}
