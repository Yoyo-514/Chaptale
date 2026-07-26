import type { ChatMessage } from '@chaptale/shared';

export type MessageBranchControl = {
  current: number;
  total: number;
  previousLeafId?: string;
  nextLeafId?: string;
};

export type ChatSearchMatch = {
  id: string;
  index: number;
  toolTarget?: {
    callId: string;
    section: 'call' | 'result';
  };
};

export type ChatDisplayMessage = {
  id: string;
  message: ChatMessage;
  variant?: 'normal' | 'error';
  /** 仅存在于当前 Renderer 生命周期的乐观交付状态，不写入持久化 ChatMessage。 */
  deliveryState?: 'submitting' | 'queued';
  entryId?: string;
  parentEntryId?: string | null;
  branch?: MessageBranchControl;
  /** 该消息之前发生过上下文压缩，渲染时在消息上方插入压缩提示。 */
  compactionBefore?: {
    summary: string;
    tokensBefore: number;
  };
};
