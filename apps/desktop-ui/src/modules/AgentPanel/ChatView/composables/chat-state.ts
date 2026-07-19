import type { SlashCommand } from '@chaptale/ipc-contract';
import type { ChatContextFile } from '@chaptale/shared';
import type { ChatDisplayMessage } from '../types';

/**
 * ChatView 的临时交互状态。
 * 会话与设置的持久化事实由 Pinia store 管理，此对象只承载当前视图的消息投影、输入草稿和运行状态。
 */
export type ChatState = {
  messages: ChatDisplayMessage[];
  input: string;
  editingMessageId: string;
  isConnecting: boolean;
  isReplying: boolean;
  /** steer IPC 正在提交时为 true，用于阻止重复发送和草稿竞态。 */
  isSubmittingSteer: boolean;
  isEnabledWebSearch: boolean;
  isLoadingMessages: boolean;
  contextFiles: ChatContextFile[];
  slashCommands: SlashCommand[];
};

/** 创建 ChatView 的独立临时状态。 */
export function createChatState(): ChatState {
  return {
    messages: [],
    input: '',
    editingMessageId: '',
    isConnecting: false,
    isReplying: false,
    isSubmittingSteer: false,
    isEnabledWebSearch: true,
    isLoadingMessages: true,
    contextFiles: [],
    slashCommands: []
  };
}
