import { generateText } from 'ai';

import type { ResolvedModel } from '../models/runtime';
import { defaultKeepRecentTokens, resolveCompactionCutPoint } from '../sessions/compaction-cut';
import type { SessionMessage } from '../sessions/entry';
import type { SessionStore } from '../sessions/store';
import { estimateMessagesTokens } from '../sessions/token-estimate';

export type CompactOptions = {
  model: ResolvedModel;
  store: SessionStore;
  /** 压缩提示词（装配层注入，服务创作场景的文案由 features/prompts 提供）。 */
  prompt: string;
  /** 保留近期原文的 token 预算；缺省按模型窗口推导。 */
  keepRecentTokens?: number;
  abortSignal?: AbortSignal;
};

export type CompactResult = {
  summary: string;
  tokensBefore: number;
  firstKeptEntryId: string;
};

/**
 * 会话压缩：generateText 总结当前分支 → appendCompaction 落流。
 *
 * 切点由 `resolveCompactionCutPoint` 按预算回溯求得（见该模块）——摘要覆盖切点之前，
 * 切点之后逐字保留。此前这里直接把压缩时刻的 leaf 当作 firstKeptEntryId，
 * 保留区间退化成最后一条消息，近期原文全部丢弃。
 *
 * tokensBefore 与上下文压力提示共用 `estimateMessagesTokens` 口径。
 */
export async function compactSession(options: CompactOptions): Promise<CompactResult> {
  const { model, store, prompt, abortSignal } = options;

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

  // 只把将被折叠的部分交给模型：切点之后的原文会逐字保留，重复送去总结既费 token，
  // 又会让摘要与保留原文互相重复。上一轮摘要必须一并折入，否则它承载的历史会丢失。
  const folded = projection.entries.slice(0, cut.foldedCount).map(entry => entry.message);
  const transcript = [
    ...(projection.summary ? [`既往摘要：${projection.summary}`] : []),
    ...folded.map(formatForTranscript)
  ].join('\n\n');

  const { text } = await generateText({
    model: model.model,
    abortSignal,
    prompt: `${prompt}\n\n以下是需要压缩的对话记录：\n\n${transcript}`
  });

  const summary = text.trim();

  if (!summary) {
    throw new Error('压缩结果为空');
  }

  const tokensBefore = estimateMessagesTokens(store.buildContextMessages());

  await store.appendCompaction(summary, cut.firstKeptEntryId, tokensBefore);

  return {
    summary,
    tokensBefore,
    firstKeptEntryId: cut.firstKeptEntryId
  };
}

/** 折叠区间 → 交给模型的纯文本；工具结果带上工具名，便于摘要保留出处。 */
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
