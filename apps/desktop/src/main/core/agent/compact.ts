import { generateText } from 'ai';

import type { ResolvedModel } from '../models/runtime';
import type { SessionStore } from '../sessions/store';

export type CompactOptions = {
  model: ResolvedModel;
  store: SessionStore;
  /** 压缩提示词（装配层注入，服务创作场景的文案由 features/prompts 提供）。 */
  prompt: string;
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
 * firstKeptEntryId 语义：压缩时刻的 leaf（此后回放折叠它之前的 message）；
 * tokensBefore 取消息文本长度的一半估算（粗粒度代理，避免额外 tokenize 往返）。
 */
export async function compactSession(options: CompactOptions): Promise<CompactResult> {
  const { model, store, prompt, abortSignal } = options;

  const contextMessages = store.buildContextMessages();
  const leafId = store.currentLeafId;

  if (contextMessages.length === 0) {
    throw new Error('会话没有可压缩的上下文');
  }

  const transcript = contextMessages
    .map(message => {
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
          ? `（${message.toolName}）${JSON.stringify(message.output)}`
          : typeof message.content === 'string'
            ? message.content
            : JSON.stringify(message.content);

      return `${prefix}：${body}`;
    })
    .join('\n\n');

  const { text } = await generateText({
    model: model.model,
    abortSignal,
    prompt: `${prompt}\n\n以下是需要压缩的对话记录：\n\n${transcript}`
  });

  const summary = text.trim();

  if (!summary) {
    throw new Error('压缩结果为空');
  }

  const tokensBefore = contextMessages.reduce((total, message) => {
    const body =
      message.role === 'tool'
        ? JSON.stringify(message.output)
        : typeof message.content === 'string'
          ? message.content
          : JSON.stringify(message.content);

    return total + Math.ceil(body.length / 2);
  }, 0);

  await store.appendCompaction(summary, leafId ?? '', tokensBefore);

  return {
    summary,
    tokensBefore,
    firstKeptEntryId: leafId ?? ''
  };
}
