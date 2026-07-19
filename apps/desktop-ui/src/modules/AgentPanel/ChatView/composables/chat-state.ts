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
  isEnabledWebSearch: boolean;
  isLoadingMessages: boolean;
  contextFiles: ChatContextFile[];
  slashCommands: SlashCommand[];
};

export function createChatState(): ChatState {
  return {
    messages: [],
    input: '',
    editingMessageId: '',
    isConnecting: false,
    isReplying: false,
    isEnabledWebSearch: true,
    isLoadingMessages: true,
    contextFiles: [],
    slashCommands: []
  };
}
