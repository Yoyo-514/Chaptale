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
};
