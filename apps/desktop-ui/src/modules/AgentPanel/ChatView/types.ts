import type { ChatMessage } from '@chaptale/shared';

export type MessageBranchControl = {
  current: number;
  total: number;
  previousLeafId?: string;
  nextLeafId?: string;
};

export type ChatDisplayMessage = {
  id: string;
  message: ChatMessage;
  variant?: 'normal' | 'error';
  entryId?: string;
  parentEntryId?: string | null;
  branch?: MessageBranchControl;
  /** 该消息之前发生过上下文压缩，渲染时在消息上方插入压缩提示。 */
  compactionBefore?: {
    summary: string;
    tokensBefore: number;
  };
};
