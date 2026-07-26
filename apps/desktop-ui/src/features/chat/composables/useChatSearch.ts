import { computed, ref, watch } from 'vue';

import type { ChatDisplayMessage, ChatSearchMatch } from '../types';
import {
  getAssistantReasoning,
  getAssistantText,
  getAssistantToolCalls,
  getMessagePlainText
} from '../utils/message/message-content';

/** 会话内搜索：按消息纯文本匹配，提供命中列表与前后跳转。 */
export function useChatSearch(getMessages: () => ChatDisplayMessage[]) {
  const isOpen = ref(false);
  const query = ref('');
  const activeMatchIndex = ref(0);

  const matches = computed<ChatSearchMatch[]>(() => {
    const keyword = query.value.trim().toLowerCase();

    if (!keyword) {
      return [];
    }

    return getMessages().flatMap((displayMessage, index) => findMessageMatches(displayMessage, index, keyword));
  });

  const activeMatch = computed(() => matches.value[activeMatchIndex.value]);

  watch([query, matches], () => {
    if (activeMatchIndex.value >= matches.value.length) {
      activeMatchIndex.value = Math.max(0, matches.value.length - 1);
    }
  });

  watch(query, () => {
    activeMatchIndex.value = 0;
  });

  function open() {
    isOpen.value = true;
  }

  function close() {
    isOpen.value = false;
    query.value = '';
    activeMatchIndex.value = 0;
  }

  function goToNext() {
    if (matches.value.length > 0) {
      activeMatchIndex.value = (activeMatchIndex.value + 1) % matches.value.length;
    }
  }

  function goToPrevious() {
    if (matches.value.length > 0) {
      activeMatchIndex.value = (activeMatchIndex.value - 1 + matches.value.length) % matches.value.length;
    }
  }

  return {
    isOpen,
    query,
    matches,
    activeMatchIndex,
    activeMatch,
    open,
    close,
    goToNext,
    goToPrevious
  };
}

function findMessageMatches(displayMessage: ChatDisplayMessage, index: number, keyword: string): ChatSearchMatch[] {
  const message = displayMessage.message;

  if (message.role === 'assistant') {
    const matches: ChatSearchMatch[] = [];
    const assistantText = [message.errorMessage, getAssistantText(message), getAssistantReasoning(message)]
      .filter(Boolean)
      .join('\n')
      .toLowerCase();

    if (assistantText.includes(keyword)) {
      matches.push({ id: displayMessage.id, index });
    }

    for (const call of getAssistantToolCalls(message)) {
      const searchableCall = `${call.name}\n${JSON.stringify(call.arguments, null, 2)}`.toLowerCase();

      if (searchableCall.includes(keyword)) {
        matches.push({ id: displayMessage.id, index, toolTarget: { callId: call.id, section: 'call' } });
      }
    }

    return matches;
  }

  if (!getMessagePlainText(message).toLowerCase().includes(keyword)) {
    return [];
  }

  return [
    {
      id: displayMessage.id,
      index,
      ...(message.role === 'toolResult'
        ? { toolTarget: { callId: message.toolCallId, section: 'result' as const } }
        : {})
    }
  ];
}
