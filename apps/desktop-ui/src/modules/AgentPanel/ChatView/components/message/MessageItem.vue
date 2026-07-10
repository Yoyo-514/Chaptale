<script setup lang="ts">
import { computed } from 'vue';

import { errorToMessage } from '@chaptale/shared';
import { AppImagePreview } from '@/components/AppImagePreview';
import { useNotificationStore } from '@/stores/notification';
import { cn } from '@/utils';
import { formatMessageCost, formatMessageTime, formatTokenCount } from '@/utils/session-display';
import type { ChatDisplayMessage } from '../../types';
import { toInlineImageItems } from '../../utils/message/inline-images';
import {
  getAssistantImages,
  getAssistantReasoning,
  getAssistantReasoningStatus,
  getAssistantText,
  getAssistantToolCalls,
  getMessagePlainText,
  getTextBlocks,
  getToolResultImages,
  getUserContextFiles,
  getUserImages,
  getUserText,
  hasRenderableMessage,
  hasUserAttachments
} from '../../utils/message/message-content';
import AssistantMessage from './AssistantMessage.vue';
import ErrorMessage from './ErrorMessage.vue';
import MessageActions from './MessageActions.vue';
import MessageCompactionNotice from './MessageCompactionNotice.vue';
import ToolCallMessage from './ToolCallMessage.vue';
import ToolResultMessage from './ToolResultMessage.vue';
import UserBranchNavigator from './UserBranchNavigator.vue';
import UserMessage from './UserMessage.vue';

const props = defineProps<{
  displayMessage: ChatDisplayMessage;
  isEditing?: boolean;
  isBusy?: boolean;
  isSearchHit?: boolean;
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
const userContextFiles = computed(() => (message.value.role === 'user' ? getUserContextFiles(message.value) : []));
const userImages = computed(() => (message.value.role === 'user' ? getUserImages(message.value) : []));
const assistantContent = computed(() => (message.value.role === 'assistant' ? getAssistantText(message.value) : ''));
const assistantReasoning = computed(() =>
  message.value.role === 'assistant' ? getAssistantReasoning(message.value) : ''
);
const assistantReasoningStatus = computed(() =>
  message.value.role === 'assistant' ? getAssistantReasoningStatus(message.value) : undefined
);
const assistantPartial = computed(() => (message.value.role === 'assistant' ? message.value.partial : undefined));
const assistantToolCalls = computed(() =>
  message.value.role === 'assistant' ? getAssistantToolCalls(message.value) : []
);
const showAssistantBody = computed(() =>
  Boolean(assistantContent.value || assistantReasoning.value || assistantPartial.value)
);
const assistantImageItems = computed(() =>
  message.value.role === 'assistant'
    ? toInlineImageItems(getAssistantImages(message.value), props.displayMessage.id)
    : []
);
const toolResultImageItems = computed(() =>
  message.value.role === 'toolResult'
    ? toInlineImageItems(getToolResultImages(message.value), props.displayMessage.id)
    : []
);
const toolResultContent = computed(() =>
  message.value.role === 'toolResult'
    ? getTextBlocks(message.value.content)
        .map(block => block.text)
        .join('\n')
    : ''
);
const stopNotice = computed(() => {
  if (message.value.role !== 'assistant' || message.value.partial) {
    return '';
  }

  if (message.value.stopReason === 'aborted') {
    return '已手动停止，回复可能不完整';
  }

  if (message.value.stopReason === 'length') {
    return '达到输出长度上限，回复被截断';
  }

  return '';
});
const messageMeta = computed(() => {
  const parts: string[] = [];
  const time = formatMessageTime(message.value.timestamp);

  if (time) {
    parts.push(time);
  }

  if (message.value.role === 'assistant' && message.value.usage) {
    parts.push(`${formatTokenCount(message.value.usage.totalTokens)} tokens`);
    const cost = formatMessageCost(message.value.usage.cost);

    if (cost) {
      parts.push(cost);
    }
  }

  return parts.join(' · ');
});
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
const showActions = computed(() => isRenderable.value);
const canEdit = computed(
  () =>
    !props.isBusy &&
    message.value.role === 'user' &&
    (!hasUserAttachments(message.value) || Boolean(props.displayMessage.entryId))
);
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
    notificationStore.error('复制失败', errorToMessage(error));
  }
}
</script>

<template>
  <div
    v-if="isRenderable"
    :class="
      cn(
        'message-container',
        isUserMessage && 'message-container-user',
        props.isSearchHit && 'message-container-search-hit'
      )
    "
  >
    <div :class="cn('message-content-stack', isUserMessage && 'message-content-stack-user')">
      <MessageCompactionNotice
        v-if="displayMessage.compactionBefore"
        :summary="displayMessage.compactionBefore.summary"
        :tokens-before="displayMessage.compactionBefore.tokensBefore"
      />

      <UserMessage
        v-if="message.role === 'user'"
        :content="userContent"
        :context-files="userContextFiles"
        :images="userImages"
        :editing="isEditing"
        @save="content => emit('saveUser', displayMessage.id, content)"
        @cancel="emit('cancelEdit')"
      />

      <ErrorMessage v-else-if="showAssistantError" title="AI 回复失败" :content="assistantErrorContent" />

      <template v-else-if="isAssistantMessage">
        <AssistantMessage
          v-if="showAssistantBody"
          :message-id="displayMessage.id"
          :content="assistantContent"
          :reasoning="assistantReasoning"
          :reasoning-status="assistantReasoningStatus"
          :partial="assistantPartial"
        />

        <ToolCallMessage
          v-for="toolCall in assistantToolCalls"
          :key="toolCall.id"
          :name="toolCall.name"
          :args="toolCall.arguments"
        />

        <div v-if="assistantImageItems.length" class="message-inline-images">
          <AppImagePreview :items="assistantImageItems" />
        </div>

        <p v-if="stopNotice" class="message-stop-notice">
          <span class="i-mingcute-alert-line size-3.5" aria-hidden="true" />
          {{ stopNotice }}
        </p>
      </template>

      <template v-else-if="message.role === 'toolResult'">
        <ToolResultMessage :name="message.toolName" :content="toolResultContent" />
        <div v-if="toolResultImageItems.length" class="message-inline-images">
          <AppImagePreview :items="toolResultImageItems" />
        </div>
      </template>

      <UserBranchNavigator
        v-if="message.role === 'user' && displayMessage.branch && !isEditing"
        :branch="displayMessage.branch"
        @switch-branch="emit('switchBranch', $event)"
      />

      <div v-if="showActions && !isEditing" class="message-footer">
        <MessageActions
          :can-edit="canEdit"
          :can-regenerate="canRegenerate"
          :class="cn(isUserMessage && 'message-actions-user')"
          @copy="copyRawText"
          @edit="emit('editUser', displayMessage.id)"
          @regenerate="emit('regenerateAssistant', displayMessage.id)"
        />
        <span v-if="messageMeta" class="message-meta">{{ messageMeta }}</span>
      </div>
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

.message-container-search-hit {
  @apply rounded-2xl;

  outline: 2px solid var(--primary);
  outline-offset: 2px;
}

.message-content-stack {
  @apply flex w-full max-w-full flex-col items-start gap-1;
}

.message-content-stack:hover :deep(.message-actions),
.message-content-stack:focus-within :deep(.message-actions),
.message-content-stack:hover .message-meta,
.message-content-stack:focus-within .message-meta {
  opacity: 1;
}

.message-content-stack-user {
  @apply items-end;
}

.message-footer {
  @apply flex items-center gap-2;
}

.message-content-stack-user .message-footer {
  @apply flex-row-reverse;
}

.message-meta {
  @apply text-[11px] opacity-0 transition-opacity duration-150;

  color: var(--muted-foreground);
}

.message-stop-notice {
  @apply m-0 flex items-center gap-1.5 text-xs;

  color: var(--muted-foreground);
}

.message-inline-images {
  @apply w-full;
}
</style>
