import { ref } from 'vue';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

import { useNotificationStore } from '@/stores/notification';
import { useSessionStore } from '@/stores/session';
import { toErrorMessage } from '@/stores/utils/desktop-api';

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
  // 会话快速切换会产生并发读取；序号保证迟到的旧响应不能覆盖当前会话。
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

      // 优先保留用户刚选择的分支；首次加载才回退到 store 记录或最新条目。
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
