import { estimateTextTokens } from '../context/token-counter';
import type { SessionContentPart, SessionMessage } from './entry';

/**
 * 会话消息的 token 估算：上下文压力提示与压缩前后对比共用同一口径。
 *
 * 口径必须统一且**不低估中文**。按 `length / 2` 估算对纯中文正文会低估一倍，
 * 而压力阈值是 70%：提示要等真实占用约 140% 时才触发，早就溢出了，
 * 对中文长篇创作 IDE 而言等于"上下文压力提示不存在"。
 *
 * 精确 tokenize 需要按 provider 加载词表并做一次额外往返，代价与收益不成比例；
 * 这里要的是不低估，宁可略保守。
 */

/**
 * 图片按块计费（视觉模型约 1–1.5k/图），与 base64 长度无关。
 *
 * 这一条不能退化成"按 JSON 长度算"：一张 2MB 图的 base64 有约 270 万字符，
 * 会把估算推高三个数量级，让压缩误判整段历史都必须折叠。
 */
const IMAGE_TOKEN_ESTIMATE = 1_500;

/**
 * 每条消息的协议开销（role 标记与分隔符）。
 *
 * 单条可忽略，但长会话里几百条短消息累计起来不是噪声。
 */
const MESSAGE_OVERHEAD_TOKENS = 4;

export function estimateMessagesTokens(messages: SessionMessage[]): number {
  return messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function estimateMessageTokens(message: SessionMessage): number {
  return MESSAGE_OVERHEAD_TOKENS + estimateBodyTokens(message);
}

function estimateBodyTokens(message: SessionMessage): number {
  switch (message.role) {
    case 'system':
      return estimateTextTokens(message.content);

    case 'tool':
      return estimateTextTokens(stringifyOutput(message.output));

    case 'user':
      return estimateContentTokens(message.content);

    case 'assistant':
      // reasoning 不计：它只落盘供 UI 展示，不进模型回放（见 entry.ts / messages.ts）。
      return (
        estimateContentTokens(message.content) +
        (message.toolCalls ?? []).reduce(
          (total, call) => total + estimateTextTokens(call.name) + estimateTextTokens(stringifyOutput(call.arguments)),
          0
        )
      );
  }
}

function estimateContentTokens(content: string | SessionContentPart[] | undefined): number {
  if (typeof content === 'string') {
    return estimateTextTokens(content);
  }

  if (!content) {
    return 0;
  }

  return content.reduce(
    (total, part) => total + (part.type === 'text' ? estimateTextTokens(part.text) : IMAGE_TOKEN_ESTIMATE),
    0
  );
}

function stringifyOutput(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }

  try {
    return JSON.stringify(value ?? '') ?? '';
  } catch {
    return String(value);
  }
}
