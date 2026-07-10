import { computed, ref, watch } from 'vue';

import type { ChatDisplayMessage } from '../types';
import { getMessagePlainText } from '../utils/message/message-content';

/** 会话内搜索：按消息纯文本匹配，提供命中列表与前后跳转。 */
export function useChatSearch(getMessages: () => ChatDisplayMessage[]) {
  const isOpen = ref(false);
  const query = ref('');
  const activeMatchIndex = ref(0);

  const matches = computed(() => {
    const keyword = query.value.trim().toLowerCase();

    if (!keyword) {
      return [];
    }

    return getMessages()
      .map((displayMessage, index) => ({ id: displayMessage.id, index, message: displayMessage.message }))
      .filter(candidate => getMessagePlainText(candidate.message).toLowerCase().includes(keyword))
      .map(candidate => ({ id: candidate.id, index: candidate.index }));
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
