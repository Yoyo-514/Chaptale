<script setup lang="ts">
import type { WebsearchResult } from '@chaptale/shared';
import { computed, ref } from 'vue';

const props = defineProps<{
  content: string;
}>();

const showAll = ref(false);
const websearchResults = computed<WebsearchResult>(() => {
  try {
    const parsed = JSON.parse(props.content);
    return Array.isArray(parsed) ? (parsed as WebsearchResult) : [];
  } catch {
    return [];
  }
});
const displayedResults = computed(() => (showAll.value ? websearchResults.value : websearchResults.value.slice(0, 4)));
const hasMore = computed(() => websearchResults.value.length > displayedResults.value.length || showAll.value);

function getHostname(link: string) {
  try {
    return new URL(link).hostname.replace(/^www\./, '');
  } catch {
    return link;
  }
}
</script>

<template>
  <div class="websearch-citations">
    <p class="websearch-citations-header">
      <span class="i-mingcute-earth-line" aria-hidden="true" />
      已检索 {{ websearchResults.length }} 个来源
    </p>

    <div class="websearch-citation-list">
      <a
        v-for="(result, index) in displayedResults"
        :key="`${result.link}-${index}`"
        class="websearch-citation"
        :href="result.link"
        target="_blank"
        rel="noreferrer"
        :title="result.description || result.title"
      >
        <span class="websearch-citation-index">{{ index + 1 }}</span>
        <span class="websearch-citation-content">
          <span class="websearch-citation-title">{{ result.title }}</span>
          <span class="websearch-citation-source">{{ getHostname(result.link) }}</span>
          <span v-if="showAll && result.description" class="websearch-citation-description">
            {{ result.description }}
          </span>
        </span>
        <span class="i-mingcute-external-link-line websearch-citation-link" aria-hidden="true" />
      </a>
    </div>

    <button v-if="hasMore" class="websearch-citations-toggle" type="button" @click="showAll = !showAll">
      {{ showAll ? '收起来源' : `展开全部 ${websearchResults.length} 个来源` }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.websearch-citations {
  @apply flex max-w-full flex-col gap-2 rounded-xl border border-border-subtle bg-surface-acrylic p-3 text-foreground shadow-inset-highlight;
}

.websearch-citations-header {
  @apply flex items-center gap-2 text-sm font-medium text-secondary-foreground;
}

.websearch-citation-list {
  @apply grid gap-1;
}

.websearch-citation {
  @apply grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-surface-muted;
}

.websearch-citation-index {
  @apply flex-center mt-0.5 size-5 rounded-full bg-secondary text-xs text-secondary-foreground;
}

.websearch-citation-content {
  @apply flex min-w-0 flex-col gap-0.5;
}

.websearch-citation-title {
  @apply truncate text-sm font-medium text-primary-solid;
}

.websearch-citation-source,
.websearch-citation-description {
  @apply text-xs text-muted-foreground;
}

.websearch-citation-description {
  @apply line-clamp-2;
}

.websearch-citation-link {
  @apply mt-1 text-muted-foreground;
}

.websearch-citations-toggle {
  @apply self-center rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors duration-150 hover:bg-surface-muted hover:text-foreground;
}
</style>
