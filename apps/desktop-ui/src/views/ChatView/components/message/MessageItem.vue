<script setup lang="ts">
import { computed } from 'vue';

import { useNotificationStore } from '@/stores/notification';
import { cn } from '@/utils';
import type { ChatDisplayMessage } from '../../types';
import { getMessagePlainText, hasRenderableMessage } from '../../utils/message/message-content';
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
const isUserMessage = computed(() => message.value.type === 'user');
const isRenderable = computed(() => hasRenderableMessage(message.value, props.displayMessage.variant));
const showActions = computed(
  () => isRenderable.value && (message.value.type !== 'system' || props.displayMessage.variant === 'error')
);
const canEdit = computed(() => !props.isBusy && message.value.type === 'user');
const canRegenerate = computed(() => !props.isBusy && message.value.type === 'assistant' && !message.value.partial);

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
        v-if="message.type === 'user'"
        :content="message.payload.content"
        :editing="isEditing"
        @save="content => emit('saveUser', displayMessage.id, content)"
        @cancel="emit('cancelEdit')"
      />

      <AssistantMessage
        v-else-if="message.type === 'assistant'"
        :message-id="displayMessage.id"
        :content="message.payload.content"
        :reasoning="message.payload.reasoning"
        :reasoning-status="message.payload.reasoningStatus"
        :partial="message.partial"
      />

      <ToolCallMessage
        v-else-if="message.type === 'tool_call'"
        :name="message.payload.name"
        :args="message.payload.args"
      />

      <ToolResultMessage
        v-else-if="message.type === 'tool_result'"
        :name="message.payload.name"
        :content="message.payload.content"
      />

      <ErrorMessage
        v-else-if="message.type === 'system' && displayMessage.variant === 'error'"
        title="AI 回复失败"
        :content="message.payload.content"
      />

      <UserBranchNavigator
        v-if="message.type === 'user' && displayMessage.branch && !isEditing"
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
