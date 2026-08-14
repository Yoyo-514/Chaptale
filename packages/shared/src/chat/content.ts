import type { ChatImageAttachment } from './image';

/** 用户消息文本段（OpenAI content part 形状）。 */
export type ChatTextPart = {
  type: 'text';
  text: string;
};

/** 用户消息内容：纯文本或分段（文本 + 轻量图片附件）。 */
export type ChatUserContent = string | Array<ChatTextPart | ChatImageAttachment>;

/** assistant 消息上的工具调用（扁平数组，OpenAI tool_calls 形状）。 */
export type ChatToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};
