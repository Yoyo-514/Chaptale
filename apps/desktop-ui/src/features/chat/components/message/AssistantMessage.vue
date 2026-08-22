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

    <div v-if="content" class="assistant-answer markdown-body" v-html="answerHtml" />

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

// 答案卡片：markdown-body 只出排版，卡片外观在这里给。
.assistant-answer {
  @apply rounded-xl border border-border-subtle bg-surface-acrylic px-4 py-3 shadow-$shadow-inset-highlight;

  backdrop-filter: var(--blur-acrylic-subtle);
}

.assistant-reasoning {
  @apply max-w-full overflow-hidden rounded-xl border border-border-subtle bg-surface-acrylic text-muted-foreground shadow-$shadow-inset-highlight;

  font-size: var(--chat-secondary-font-size, 0.875rem);
  line-height: 1.55;
}

.assistant-reasoning[open] {
  @apply text-foreground;
}

.assistant-reasoning-summary {
  @apply flex cursor-pointer select-none items-center gap-2 px-4 py-2 transition-colors duration-150;
}

// 与折叠工具卡片同一套反馈：整条触发区换底色，而不是只改文字色。
.assistant-reasoning-summary:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}

// 折叠区内容：外层已经是卡片，这里只补内边距与分隔线。
// 方角由外层的 overflow-hidden 收掉，触发区的 hover 底色同理。
.assistant-reasoning-content {
  @apply border-t border-border-subtle bg-surface-muted/40 px-4 py-3;
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
