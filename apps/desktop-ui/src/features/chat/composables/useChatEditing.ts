import { useNotificationStore } from '@/features/notifications';

import { markUserMessageAsOptimisticBranch } from '../utils/message/display-message';
import { getUserImages, getUserText, hasUserAttachments } from '../utils/message/message-content';
import type { ChatState } from './chat-state';
import type { RunQueryOptions } from './useChatStreaming';

type UseChatEditingOptions = {
  state: ChatState;
  runQuery: (query: string, options: RunQueryOptions) => Promise<void>;
};

/** 用户消息编辑与助手回复重生成（都会产生新分支）。 */
export function useChatEditing({ state, runQuery }: UseChatEditingOptions) {
  const notificationStore = useNotificationStore();

  function handleEditUserMessage(messageId: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const displayMessage = state.messages.find(item => item.id === messageId);

    if (
      displayMessage?.message.role === 'user' &&
      hasUserAttachments(displayMessage.message) &&
      !displayMessage.entryId
    ) {
      notificationStore.info('附件仍在持久化', '请等待当前回复结束后再编辑');
      return;
    }

    state.editingMessageId = messageId;
  }

  function handleCancelEdit() {
    state.editingMessageId = '';
  }

  async function handleSaveUserMessage(messageId: string, content: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const messageIndex = state.messages.findIndex(displayMessage => displayMessage.id === messageId);
    const displayMessage = state.messages[messageIndex];

    if (!displayMessage || displayMessage.message.role !== 'user') {
      return;
    }

    const hasAttachments = hasUserAttachments(displayMessage.message);

    if (hasAttachments && !displayMessage.entryId) {
      notificationStore.info('附件仍在持久化', '请等待当前回复结束后再编辑');
      return;
    }

    const images = getUserImages(displayMessage.message);
    // 先把当前投影视为新分支的用户节点并截断其后消息，随后由 runQuery 从原 parent 创建持久化分支。
    displayMessage.message.content = images.length > 0 ? [{ type: 'text', text: content }, ...images] : content;
    delete displayMessage.message.skillInvocation;
    markUserMessageAsOptimisticBranch(displayMessage);
    state.messages.splice(messageIndex + 1);
    await runQuery(content, {
      appendUser: false,
      branchFromEntryId: displayMessage.parentEntryId ?? null,
      reuseUserEntryId: hasAttachments ? displayMessage.entryId : undefined
    });
  }

  async function handleRegenerateAssistantMessage(messageId: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    const assistantIndex = state.messages.findIndex(displayMessage => displayMessage.id === messageId);

    if (assistantIndex === -1) {
      return;
    }

    const userMessage = state.messages
      .slice(0, assistantIndex)
      .findLast(displayMessage => displayMessage.message.role === 'user');

    if (!userMessage || userMessage.message.role !== 'user') {
      return;
    }

    const hasAttachments = hasUserAttachments(userMessage.message);

    if (hasAttachments && !userMessage.entryId) {
      notificationStore.info('附件仍在持久化', '请等待当前回复结束后再重新生成');
      return;
    }

    const userIndex = state.messages.findIndex(displayMessage => displayMessage.id === userMessage.id);

    if (userIndex === -1) {
      return;
    }

    // 重新生成不是覆盖旧助手消息，而是从最近用户节点的父级创建另一条可切换分支。
    state.messages.splice(userIndex + 1);
    await runQuery(getUserText(userMessage.message), {
      appendUser: false,
      branchFromEntryId: userMessage.parentEntryId ?? null,
      reuseUserEntryId: hasAttachments ? userMessage.entryId : undefined
    });
  }

  return { handleEditUserMessage, handleCancelEdit, handleSaveUserMessage, handleRegenerateAssistantMessage };
}
