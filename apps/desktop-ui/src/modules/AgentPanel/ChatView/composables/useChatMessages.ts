import { ref } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { useSessionStore } from '@/stores/session';
import { toErrorMessage } from '@/stores/utils/desktop-api';
import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { buildDisplayMessagesFromEntries } from '../utils/message/branching';
import type { ChatState } from './chat-state';
import type { useAssistantStreamingMessages } from './useAssistantStreamingMessages';

type UseChatMessagesOptions = {
  state: ChatState;
  assistantStreaming: ReturnType<typeof useAssistantStreamingMessages>;
  getDesktopApiOrNotify: () => ChaptaleDesktopApi | undefined;
};

/** 会话消息的加载与分支切换。 */
export function useChatMessages({ state, assistantStreaming, getDesktopApiOrNotify }: UseChatMessagesOptions) {
  const sessionStore = useSessionStore();
  const notificationStore = useNotificationStore();
  const currentLeafId = ref<string | null>(null);
  let loadMessagesSequence = 0;

  async function loadCurrentSessionMessages() {
    const sequence = (loadMessagesSequence += 1);
    state.isLoadingMessages = true;
    assistantStreaming.reset();

    try {
      if (!getDesktopApiOrNotify()) {
        return;
      }

      const entries = await sessionStore.getCurrentEntries().catch(error => {
        notificationStore.error('读取会话消息失败', toErrorMessage(error));
        return [];
      });

      if (sequence !== loadMessagesSequence) {
        return;
      }

      currentLeafId.value = currentLeafId.value ?? sessionStore.currentSession?.leafId ?? entries.at(-1)?.id ?? null;
      state.messages = buildDisplayMessagesFromEntries(entries, currentLeafId.value);
    } finally {
      if (sequence === loadMessagesSequence) {
        state.isLoadingMessages = false;
      }
    }
  }

  async function handleSelectRecentSession(sessionId: string) {
    currentLeafId.value = null;
    await sessionStore.selectSession(sessionId);
  }

  async function handleSwitchBranch(leafId: string) {
    if (state.isConnecting || state.isReplying) {
      return;
    }

    currentLeafId.value = leafId;
    await sessionStore.setCurrentLeaf(leafId);
    await loadCurrentSessionMessages();
  }

  return { currentLeafId, loadCurrentSessionMessages, handleSelectRecentSession, handleSwitchBranch };
}
