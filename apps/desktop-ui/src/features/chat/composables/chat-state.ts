import type { ChaptaleReasoningEffort, SlashCommand } from '@chaptale/ipc-contract';
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
  /** 取消 IPC 已成功发起或正在等待响应，但唯一 end 终态尚未收束运行。 */
  isCancelling: boolean;
  /** steer IPC 正在提交时为 true，用于阻止重复发送和草稿竞态。 */
  isSubmittingSteer: boolean;
  isEnabledWebSearch: boolean;
  /**
   * 本轮发送要用的推理档位；空串表示跟随模型自己配的那个。
   *
   * 与联网开关的存法不同，它有意不写回任何设置：联网开关问的是「这个工具能不能用」，
   * 属于配置；档位问的是「这一次要想多深」，属于这一次的任务。留在这里意味着
   * 重开应用即回到模型配置，不会有一个记不起何时选过的档位一直生效——
   * 但同一次使用期内跨会话保留，作者连开几个会话时不必反复重选。
   */
  reasoningEffort: ChaptaleReasoningEffort | '';
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
    isCancelling: false,
    isSubmittingSteer: false,
    isEnabledWebSearch: true,
    reasoningEffort: '',
    isLoadingMessages: true,
    contextFiles: [],
    slashCommands: []
  };
}
