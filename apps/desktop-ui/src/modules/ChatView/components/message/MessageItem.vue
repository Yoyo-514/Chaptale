<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { cn } from '@/utils';
import type { ChatDisplayMessage } from '../../types';
import {
  getAssistantReasoning,
  getAssistantReasoningStatus,
  getAssistantText,
  getMessagePlainText,
  getPrimaryToolCall,
  getTextBlocks,
  getUserText,
  hasRenderableMessage
} from '../../utils/message/message-content';
import AssistantMessage from './AssistantMessage.vue';
import ErrorMessage from './ErrorMessage.vue';
import MessageActions from './MessageActions.vue';
import ToolCallMessage from './ToolCallMessage.vue';
import ToolResultMessage from './ToolResultMessage.vue';
import UserBranchNavigator from './UserBranchNavigator.vue';
import UserMessage from './UserMessage.vue';

const props = defineProps<{
  displayMessage: ChatDisplayMessage;
  isEditing?: boolean;
  isBusy?: boolean;
}>();

const emit = defineEmits<{
  editUser: [messageId: string];
  saveUser: [messageId: string, content: string];
  cancelEdit: [];
  regenerateAssistant: [messageId: string];
  switchBranch: [leafId: string];
}>();

const notificationStore = useNotificationStore();
const message = computed(() => props.displayMessage.message);
const isUserMessage = computed(() => message.value.role === 'user');
const isAssistantMessage = computed(() => message.value.role === 'assistant');
const isRenderable = computed(() => hasRenderableMessage(message.value));
const userContent = computed(() => (message.value.role === 'user' ? getUserText(message.value) : ''));
const assistantContent = computed(() => (message.value.role === 'assistant' ? getAssistantText(message.value) : ''));
const assistantReasoning = computed(() =>
  message.value.role === 'assistant' ? getAssistantReasoning(message.value) : ''
);
const assistantReasoningStatus = computed(() =>
  message.value.role === 'assistant' ? getAssistantReasoningStatus(message.value) : undefined
);
const assistantPartial = computed(() => (message.value.role === 'assistant' ? message.value.partial : undefined));
const toolCall = computed(() => (message.value.role === 'assistant' ? getPrimaryToolCall(message.value) : undefined));
const toolResultContent = computed(() =>
  message.value.role === 'toolResult'
    ? getTextBlocks(message.value.content)
        .map(block => block.text)
        .join('\n')
    : ''
);
const assistantErrorContent = computed(() => {
  if (message.value.role !== 'assistant') {
    return '';
  }

  if (message.value.retry?.status === 'retrying') {
    const seconds = message.value.retry.delayMs ? Math.ceil(message.value.retry.delayMs / 1000) : undefined;
    return [
      message.value.retry.errorMessage ?? message.value.errorMessage ?? '请求失败，正在重试',
      `正在重试 ${message.value.retry.attempt}/${message.value.retry.maxAttempts}${seconds ? `，约 ${seconds} 秒后继续` : ''}`
    ].join('\n');
  }

  if (message.value.retry?.status === 'failed') {
    return (
      message.value.retry.finalError ?? message.value.retry.errorMessage ?? message.value.errorMessage ?? 'AI 回复失败'
    );
  }

  return message.value.errorMessage ?? '';
});
const showAssistantError = computed(() =>
  Boolean(
    message.value.role === 'assistant' &&
    (message.value.stopReason === 'error' || message.value.retry) &&
    assistantErrorContent.value
  )
);
const showToolCall = computed(() => Boolean(toolCall.value && !assistantContent.value && !assistantReasoning.value));
const showActions = computed(() => isRenderable.value);
const canEdit = computed(() => !props.isBusy && message.value.role === 'user');
const canRegenerate = computed(
  () => !props.isBusy && message.value.role === 'assistant' && !message.value.partial && !message.value.retry
);

async function copyRawText() {
  const content = getMessagePlainText(message.value);

  if (!content) {
    return;
  }

  try {
    await navigator.clipboard.writeText(content);
    notificationStore.success('已复制消息原文');
  } catch (error) {
    notificationStore.error('复制失败', error instanceof Error ? error.message : String(error));
  }
}
</script>

<template>
  <div v-if="isRenderable" :class="cn('message-container', isUserMessage && 'message-container-user')">
    <div :class="cn('message-content-stack', isUserMessage && 'message-content-stack-user')">
      <UserMessage
        v-if="message.role === 'user'"
        :content="userContent"
        :editing="isEditing"
        @save="content => emit('saveUser', displayMessage.id, content)"
        @cancel="emit('cancelEdit')"
      />

      <ErrorMessage v-else-if="showAssistantError" title="AI 回复失败" :content="assistantErrorContent" />

      <ToolCallMessage v-else-if="showToolCall && toolCall" :name="toolCall.name" :args="toolCall.arguments" />

      <AssistantMessage
        v-else-if="isAssistantMessage"
        :message-id="displayMessage.id"
        :content="assistantContent"
        :reasoning="assistantReasoning"
        :reasoning-status="assistantReasoningStatus"
        :partial="assistantPartial"
      />

      <ToolResultMessage
        v-else-if="message.role === 'toolResult'"
        :name="message.toolName"
        :content="toolResultContent"
      />

      <UserBranchNavigator
        v-if="message.role === 'user' && displayMessage.branch && !isEditing"
        :branch="displayMessage.branch"
        @switch-branch="emit('switchBranch', $event)"
      />

      <MessageActions
        v-if="showActions && !isEditing"
        :can-edit="canEdit"
        :can-regenerate="canRegenerate"
        :class="cn(isUserMessage && 'message-actions-user')"
        @copy="copyRawText"
        @edit="emit('editUser', displayMessage.id)"
        @regenerate="emit('regenerateAssistant', displayMessage.id)"
      />
    </div>
  </div>
</template>

<style scoped lang="scss">
.message-container {
  @apply flex w-full;
}

.message-container-user {
  @apply justify-end;
}

.message-content-stack {
  @apply flex w-full max-w-full flex-col items-start gap-1;
}

.message-content-stack:hover :deep(.message-actions),
.message-content-stack:focus-within :deep(.message-actions) {
  opacity: 1;
}

.message-content-stack-user {
  @apply items-end;
}
</style>
