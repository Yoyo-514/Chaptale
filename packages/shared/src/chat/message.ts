import type { ChatTextPart, ChatToolCall, ChatUserContent } from './content';
import type { ChatContextFile, ChatSkillInvocation } from './context';
import type { ChatImageAttachment, ChatImageSource } from './image';

export type ChatStopReason = 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';

export type ChatRetryState = {
  status: 'retrying' | 'success' | 'failed';
  attempt: number;
  maxAttempts: number;
  delayMs?: number;
  errorMessage?: string;
  finalError?: string;
};

export type ChatMessageUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

/**
 * 聊天消息（OpenAI Chat Messages 形状；store、engine、UI 三方同形状，映射层归零）。
 *
 * - user：文本 + 轻量图片附件（缩略图 + 原图 source 定位）；
 * - assistant：文本段 + 扁平 toolCalls 数组 + usage/流式元数据；
 * - tool：工具结果（output 原始载荷，details 供 UI 结构化渲染）；
 * - system：不进 UI 消息流（会话树保留原样）。
 */
export type ChatMessage =
  | {
      role: 'user';
      content: ChatUserContent;
      contextFiles?: ChatContextFile[];
      skillInvocation?: ChatSkillInvocation;
      timestamp?: number;
    }
  | {
      role: 'assistant';
      content?: string | ChatTextPart[];
      /** 思考过程（reasoning 模型独有；流式增量拼接）。 */
      reasoning?: string;
      toolCalls?: ChatToolCall[];
      usage?: ChatMessageUsage;
      partial?: boolean;
      stopReason?: ChatStopReason;
      errorMessage?: string;
      retry?: ChatRetryState;
      api?: string;
      provider?: string;
      model?: string;
      responseId?: string;
      timestamp?: number;
    }
  | {
      role: 'tool';
      toolCallId: string;
      toolName: string;
      /** 工具原始输出（模型回传与 UI 结构化渲染共用）。 */
      output: unknown;
      /** UI 结构化载荷（如 web_search 结果列表）。 */
      details?: unknown;
      isError?: boolean;
      timestamp?: number;
    }
  | {
      role: 'system';
      content: string;
      timestamp?: number;
    };

export type { ChatImageAttachment, ChatImageSource };
