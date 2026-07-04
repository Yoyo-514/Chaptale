import { computed, nextTick, onMounted, reactive, ref, watch } from 'vue';

import type { ChatMessage } from '@chaptale/shared';
import { useNotificationStore } from '../../../stores/notification';
import { useSessionStore } from '../../../stores/session';

type ChatState = {
  messages: ChatMessage[];
  input: string;
  isConnecting: boolean;
  isReplying: boolean;
  isEnabledWebSearch: boolean;
};

export function useChatController() {
  const sessionStore = useSessionStore();
  const notificationStore = useNotificationStore();
  const state = reactive<ChatState>({
    messages: [],
    input: '',
    isConnecting: false,
    isReplying: false,
    isEnabledWebSearch: true
  });

  const mainRef = ref<HTMLElement | null>(null);
  const activeRunId = ref<string>('');
  const isWelcome = computed(() => state.messages.length === 0);
  const recentSessions = computed(() =>
    sessionStore.sessions
      .filter(session => session.id !== sessionStore.currentSessionId)
      .filter(session => session.messageCount > 0 || session.lastMessagePreview || session.name)
      .slice(0, 2)
  );

  function setMainElement(element: unknown) {
    mainRef.value = element instanceof HTMLElement ? element : null;
  }

  async function scrollToBottom() {
    await nextTick();
    mainRef.value?.scrollTo({
      top: mainRef.value.scrollHeight,
      behavior: 'smooth'
    });
  }

  async function handleSelectRecentSession(sessionId: string) {
    await sessionStore.selectSession(sessionId);
  }

  async function loadCurrentSessionMessages() {
    if (!window.chaptaleDesktop) {
      notificationStore.error('当前界面需要在 Chaptale 桌面端中运行');
      return;
    }

    const messages = await sessionStore.getCurrentMessages().catch(error => {
      notificationStore.error('读取会话消息失败', error instanceof Error ? error.message : String(error));
      return [];
    });
    state.messages = messages;
    await scrollToBottom();
  }

  onMounted(loadCurrentSessionMessages);

  watch(
    () => sessionStore.currentSessionId,
    async (sessionId, previousSessionId) => {
      if (!sessionId || sessionId === previousSessionId) {
        return;
      }

      await loadCurrentSessionMessages();
    }
  );

  async function handleSend() {
    if (state.isConnecting) return;

    // 正在回复时再次点击按钮则中断流
    if (state.isReplying) {
      if (activeRunId.value) {
        await window.chaptaleDesktop?.agent.cancel(activeRunId.value);
      }
      return;
    }

    if (state.input.trim() === '') {
      return;
    }

    try {
      state.isConnecting = true;

      if (!window.chaptaleDesktop) {
        throw new Error('当前界面需要在 Chaptale 桌面端中运行');
      }

      const sessionId = await sessionStore.ensureActiveSession();
      const query = state.input.trim();

      state.messages.push({
        type: 'user',
        payload: {
          content: query
        }
      });

      state.input = '';
      state.isReplying = true;
      await scrollToBottom();

      const { runId } = await window.chaptaleDesktop.agent.stream(
        query,
        {
          onMessage: message => {
            const lastMessage = state.messages[state.messages.length - 1];

            // 合并不完全消息
            if (message.partial && lastMessage?.partial && 'content' in lastMessage.payload) {
              lastMessage.payload.content += message.payload.content;
              void scrollToBottom();
              return;
            }

            // 其他类型的消息
            state.messages.push(message);
            void scrollToBottom();
          },
          onDone: () => {
            activeRunId.value = '';
            state.isReplying = false;
            state.isConnecting = false;
            void sessionStore.loadSessions();
          },
          onError: message => {
            activeRunId.value = '';
            notificationStore.error('AI 回复失败', message);
            state.isReplying = false;
            state.isConnecting = false;
          }
        },
        sessionId
      );

      activeRunId.value = runId;
      state.isConnecting = false;
    } catch (error) {
      notificationStore.error('发送失败', error instanceof Error ? error.message : String(error));
      state.isReplying = false;
      state.isConnecting = false;
    }
  }

  return {
    state,
    setMainElement,
    isWelcome,
    recentSessions,
    handleSelectRecentSession,
    handleSend
  };
}
