<script setup lang="ts">
import { computed, onBeforeUnmount, watch } from 'vue';

import { clearStreamingMarkdownCache, renderMarkdown, renderStreamingMarkdown } from '../../utils/markdown';

const props = defineProps<{
  content: string;
  messageId: string;
  reasoning?: string;
  reasoningStatus?: 'streaming' | 'done';
  partial?: boolean;
}>();

const hasReasoning = computed(() => Boolean(props.reasoning?.trim() || props.reasoningStatus === 'streaming'));
const reasoningTitle = computed(() => (props.reasoningStatus === 'streaming' ? '思考中...' : '思考过程'));
const answerHtml = computed(() => {
  return props.partial ? renderStreamingMarkdown(props.messageId, props.content) : renderMarkdown(props.content);
});
const reasoningHtml = computed(() => renderMarkdown(props.reasoning ?? ''));

watch(
  () => props.partial,
  partial => {
    if (!partial) {
      clearStreamingMarkdownCache(props.messageId);
    }
  }
);

onBeforeUnmount(() => {
  clearStreamingMarkdownCache(props.messageId);
});
</script>

<template>
  <article class="assistant-message">
    <details v-if="hasReasoning" class="assistant-reasoning">
      <summary class="assistant-reasoning-summary">
        <span class="i-mingcute-brain-line" aria-hidden="true" />
        {{ reasoningTitle }}
      </summary>
      <div class="assistant-reasoning-content markdown-body" v-html="reasoningHtml" />
    </details>

    <div v-if="content" class="markdown-body" v-html="answerHtml" />

    <div v-if="partial" class="assistant-streaming-indicator" aria-label="正在生成">
      <span class="assistant-streaming-dot" />
      <span class="assistant-streaming-dot" />
      <span class="assistant-streaming-dot" />
    </div>
  </article>
</template>

<style scoped lang="scss">
.assistant-message {
  @apply flex max-w-full flex-col gap-2;
}

.assistant-reasoning {
  @apply max-w-full rounded-xl border border-border-subtle bg-surface-acrylic text-sm text-muted-foreground shadow-inset-highlight;
}

.assistant-reasoning[open] {
  @apply text-foreground;
}

.assistant-reasoning-summary {
  @apply flex cursor-pointer select-none items-center gap-2 px-4 py-2 transition-colors duration-150 hover:text-foreground;
}

.assistant-reasoning-content {
  @apply border-t border-border-subtle bg-surface-muted/40;
}

.assistant-streaming-indicator {
  @apply ml-4 flex items-center gap-1 text-muted-foreground;
}

.assistant-streaming-dot {
  @apply size-1.5 rounded-full bg-current;

  animation: assistant-streaming-pulse 1.2s ease-in-out infinite;
}

.assistant-streaming-dot:nth-child(2) {
  animation-delay: 0.16s;
}

.assistant-streaming-dot:nth-child(3) {
  animation-delay: 0.32s;
}

@keyframes assistant-streaming-pulse {
  0%,
  80%,
  100% {
    opacity: 0.35;
    transform: translateY(0);
  }

  40% {
    opacity: 1;
    transform: translateY(-2px);
  }
}
</style>
