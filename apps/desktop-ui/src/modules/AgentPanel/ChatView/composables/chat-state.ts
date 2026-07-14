import type { SlashCommand } from '@chaptale/ipc-contract';
import type { ChatContextFile } from '@chaptale/shared';
import type { ChatDisplayMessage } from '../types';

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
