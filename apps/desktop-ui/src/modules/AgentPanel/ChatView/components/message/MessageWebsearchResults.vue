<script setup lang="ts">
import { computed, ref } from 'vue';

import AppButton from '@/components/AppButton/AppButton.vue';
import { getHostname, parseSearchResult } from '../../utils/message/websearch-results';

const props = defineProps<{
  content: string;
}>();

const showAll = ref(false);
const parsedResult = computed(() => parseSearchResult(props.content));
const citations = computed(() => parsedResult.value.citations);
const displayedResults = computed(() => (showAll.value ? citations.value : citations.value.slice(0, 5)));
const hasMore = computed(() => citations.value.length > displayedResults.value.length || showAll.value);
const queryLabel = computed(() => {
  const count = parsedResult.value.queries.length;
  return count > 0 ? `${count} 次查询` : '联网搜索';
});
</script>

<template>
  <div class="websearch-card">
    <header class="websearch-header">
      <span class="websearch-icon i-mingcute-earth-line" aria-hidden="true" />
      <span class="websearch-heading">
        <strong>联网搜索完成</strong>
        <small>{{ queryLabel }} · {{ citations.length }} 个来源</small>
      </span>
    </header>

    <div v-if="parsedResult.queries.length" class="websearch-query-list" aria-label="搜索查询">
      <span v-for="query in parsedResult.queries.slice(0, 3)" :key="query" class="websearch-query-chip">
        {{ query }}
      </span>
      <span v-if="parsedResult.queries.length > 3" class="websearch-query-chip is-muted">
        +{{ parsedResult.queries.length - 3 }}
      </span>
    </div>

    <p v-if="parsedResult.summary" class="websearch-summary">{{ parsedResult.summary }}</p>

    <div v-if="parsedResult.statusNotes.length" class="websearch-status-list">
      <p v-for="note in parsedResult.statusNotes" :key="note" class="websearch-status-note">{{ note }}</p>
    </div>

    <div v-if="citations.length" class="websearch-citation-list">
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

    <p v-else class="websearch-empty">搜索完成，但结果中没有可解析的来源链接。</p>

    <AppButton
      v-if="hasMore"
      variant="ghost"
      size="xs"
      class="websearch-citations-toggle"
      type="button"
      @click="showAll = !showAll"
    >
      {{ showAll ? '收起来源' : `查看全部 ${citations.length} 个来源` }}
    </AppButton>
  </div>
</template>

<style scoped lang="scss">
.websearch-card {
  @apply flex max-w-full flex-col gap-2 rounded-xl border p-3 text-foreground shadow-inset-highlight;

  background: color-mix(in srgb, var(--surface-acrylic) 92%, var(--background));
  border-color: var(--border-subtle);
}

.websearch-header {
  @apply flex items-center gap-2;
}

.websearch-icon {
  @apply flex-center size-5 shrink-0 rounded-full text-xs;

  background: var(--primary-solid);
  color: var(--secondary-foreground);
}

.websearch-heading {
  @apply flex min-w-0 flex-col gap-0.5;
}

.websearch-heading strong {
  @apply text-sm font-semibold;
}

.websearch-heading small,
.websearch-summary,
.websearch-empty,
.websearch-status-note {
  @apply text-xs leading-5;

  color: var(--muted-foreground);
}

.websearch-query-list {
  @apply flex flex-wrap gap-1;
}

.websearch-query-chip {
  @apply max-w-full truncate rounded-full border px-2 py-0.5 text-xs;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.websearch-query-chip.is-muted {
  @apply shrink-0;
}

.websearch-summary {
  @apply m-0 rounded-lg border px-2.5 py-2;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
}

.websearch-status-list {
  @apply grid gap-1;
}

.websearch-status-note {
  @apply m-0 rounded-md px-2 py-1;

  background: color-mix(in srgb, var(--primary-solid) 8%, transparent);
}

.websearch-citation-list {
  @apply grid gap-1;
}

.websearch-citation {
  @apply grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-2 rounded-lg px-2 py-1.5 transition-colors duration-150 hover:bg-surface-muted;
}

.websearch-citation-index {
  @apply flex-center mt-0.5 size-5 rounded-full text-xs;

  background: color-mix(in srgb, var(--primary-solid) 14%, transparent);
  color: var(--primary-solid);
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
  @apply self-center;
}
</style>
