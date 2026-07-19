import type { ChatContextFile, ChatMessage } from '@chaptale/shared';
import { createDisplayMessage, createUserMessage } from '../utils/message/display-message';
import type { ChatState } from './chat-state';

/** 尚未收到主进程规范 user event 的输入类型。 */
export type PendingUserKind = 'prompt' | 'steer';

/** Renderer 为尚未交付的用户输入保存的原始快照。 */
export type PendingUserSubmission = {
  id: string;
  kind: PendingUserKind;
  query: string;
  contextFiles: ChatContextFile[];
  displayMessageId: string;
  status: 'submitting' | 'queued';
};

/** 待交付用户消息队列向流式控制器提供的操作集合。 */
export type PendingUserMessages = {
  enqueue: (kind: PendingUserKind, query: string, contextFiles: ChatContextFile[]) => PendingUserSubmission;
  markQueued: (id: string) => void;
  resolveNext: (message: ChatMessage) => boolean;
  rollback: (id: string) => void;
  takeQueuedSteersFromTail: (count: number) => PendingUserSubmission[];
  clear: () => void;
};

/**
 * 维护普通 prompt 与 steer 共用的 FIFO，确保 user event 不会错误覆盖最后一条乐观消息。
 */
export function usePendingUserMessages(state: ChatState): PendingUserMessages {
  const submissions: PendingUserSubmission[] = [];

  /** 创建带原始附件快照的临时用户消息。 */
  function enqueue(kind: PendingUserKind, query: string, contextFiles: ChatContextFile[]): PendingUserSubmission {
    const contextSnapshot = contextFiles.map(file => ({ ...file }));
    const displayMessage = createDisplayMessage(createUserMessage(query, contextSnapshot), 'pending-user');
    displayMessage.deliveryState = 'submitting';
    const submission: PendingUserSubmission = {
      id: displayMessage.id,
      kind,
      query,
      contextFiles: contextSnapshot,
      displayMessageId: displayMessage.id,
      status: 'submitting'
    };

    submissions.push(submission);
    state.messages.push(displayMessage);
    return submission;
  }

  /** 将主进程已接受的 steer 标记为仍待 SDK 消费。 */
  function markQueued(id: string): void {
    const submission = submissions.find(item => item.id === id);
    const displayMessage = state.messages.find(item => item.id === submission?.displayMessageId);

    if (!submission || !displayMessage) {
      return;
    }

    submission.status = 'queued';
    displayMessage.deliveryState = 'queued';
  }

  /** 按发送顺序用规范 user message 替换最早的临时消息。 */
  function resolveNext(message: ChatMessage): boolean {
    const submission = submissions.shift();

    if (!submission) {
      return false;
    }

    const displayMessage = state.messages.find(item => item.id === submission.displayMessageId);

    if (displayMessage) {
      const optimisticMessage = displayMessage.message;

      // Pi message_start 不携带应用图片展示元数据；保留乐观内容，仅采用规范时间戳与解码字段。
      displayMessage.message =
        optimisticMessage.role === 'user' && message.role === 'user'
          ? {
              ...message,
              content: optimisticMessage.content,
              ...(message.contextFiles || optimisticMessage.contextFiles
                ? { contextFiles: message.contextFiles ?? optimisticMessage.contextFiles }
                : {}),
              ...(message.skillInvocation || optimisticMessage.skillInvocation
                ? { skillInvocation: message.skillInvocation ?? optimisticMessage.skillInvocation }
                : {})
            }
          : message;
      delete displayMessage.deliveryState;
    }

    return true;
  }

  /** 删除提交失败的记录及其临时展示消息。 */
  function rollback(id: string): void {
    const submissionIndex = submissions.findIndex(item => item.id === id);

    if (submissionIndex < 0) {
      return;
    }

    const [submission] = submissions.splice(submissionIndex, 1);
    const displayIndex = state.messages.findIndex(item => item.id === submission!.displayMessageId);

    if (displayIndex >= 0) {
      state.messages.splice(displayIndex, 1);
    }
  }

  /**
   * 按 SDK 实际清除数量取本地 queued steer 的尾部；队首可能已在点击期间被模型消费。
   */
  function takeQueuedSteersFromTail(count: number): PendingUserSubmission[] {
    const queued = submissions.filter(item => item.kind === 'steer' && item.status === 'queued');
    const restored = queued.slice(Math.max(0, queued.length - Math.max(0, count)));
    const restoredIds = new Set(restored.map(item => item.id));

    for (let index = submissions.length - 1; index >= 0; index -= 1) {
      if (restoredIds.has(submissions[index]!.id)) {
        submissions.splice(index, 1);
      }
    }

    for (let index = state.messages.length - 1; index >= 0; index -= 1) {
      if (restoredIds.has(state.messages[index]!.id)) {
        state.messages.splice(index, 1);
      }
    }

    return restored;
  }

  /**
   * 收束运行级 FIFO：未交付的 steer 直接移除，避免伪装成已持久化历史；
   * 启动过运行的 prompt 保留展示，仅清除临时交付标记。
   */
  function clear(): void {
    for (const submission of submissions) {
      const index = state.messages.findIndex(item => item.id === submission.displayMessageId);

      if (index < 0) {
        continue;
      }

      if (submission.kind === 'steer') {
        state.messages.splice(index, 1);
      } else {
        delete state.messages[index]!.deliveryState;
      }
    }

    submissions.length = 0;
  }

  return { enqueue, markQueued, resolveNext, rollback, takeQueuedSteersFromTail, clear };
}
