<script setup lang="ts">
import { computed, ref } from 'vue';

import { getHostname, parseSearchResult, type SearchCitation } from '../../utils/message/websearch-results';

const props = defineProps<{
  content: string;
  /** 新版 web_search 工具的结构化结果；存在时优先于文本解析。 */
  results?: { title: string; url: string; snippet: string }[];
}>();

const showAll = ref(false);
const structured = computed<SearchCitation[]>(() =>
  (props.results ?? []).map(item => ({
    title: item.title,
    link: item.url,
    description: item.snippet || undefined
  }))
);
const parsedResult = computed(() =>
  structured.value.length > 0
    ? { queries: [], summary: '', citations: structured.value, statusNotes: [] }
    : parseSearchResult(props.content)
);
const citations = computed(() => parsedResult.value.citations);
const displayedResults = computed(() => (showAll.value ? citations.value : citations.value.slice(0, 5)));
const hasMore = computed(() => citations.value.length > displayedResults.value.length || showAll.value);
const metaLine = computed(() => {
  const parts: string[] = [];

  if (parsedResult.value.queries.length) {
    parts.push(`查询：${parsedResult.value.queries.join('、')}`);
  }

  parts.push(`${citations.value.length} 个来源`);
  return parts.join(' · ');
});
</script>

<template>
  <div class="websearch-results">
    <p class="websearch-meta">{{ metaLine }}</p>

    <p v-if="parsedResult.summary" class="websearch-summary">{{ parsedResult.summary }}</p>

    <p v-for="note in parsedResult.statusNotes" :key="note" class="websearch-status-note">{{ note }}</p>

    <ol v-if="citations.length" class="websearch-citation-list">
      <li v-for="(result, index) in displayedResults" :key="`${result.link}-${index}`" class="websearch-citation-item">
        <a
          class="websearch-citation"
          :href="result.link"
          target="_blank"
          rel="noreferrer"
          :title="result.description || result.title"
        >
          {{ result.title }}
        </a>
        <span class="websearch-citation-source">{{ getHostname(result.link) }}</span>
        <p v-if="showAll && result.description" class="websearch-citation-description">
          {{ result.description }}
        </p>
      </li>
    </ol>

    <p v-else class="websearch-empty">搜索完成，但结果中没有可解析的来源链接。</p>

    <button v-if="hasMore" class="websearch-citations-toggle" type="button" @click="showAll = !showAll">
      {{ showAll ? '收起来源' : `查看全部 ${citations.length} 个来源` }}
    </button>
  </div>
</template>

<style scoped lang="scss">
.websearch-results {
  @apply flex max-w-full flex-col gap-1.5 py-1 text-xs leading-5;
}

.websearch-meta,
.websearch-summary,
.websearch-empty,
.websearch-status-note,
.websearch-citation-description {
  @apply m-0;

  color: var(--muted-foreground);
}

.websearch-summary {
  @apply whitespace-pre-wrap break-words;

  color: var(--secondary-foreground);
}

.websearch-citation-list {
  @apply m-0 flex list-none flex-col gap-1 p-0;

  counter-reset: websearch-citation;
}

.websearch-citation-item {
  @apply min-w-0;

  counter-increment: websearch-citation;
}

.websearch-citation-item::before {
  @apply mr-1.5 tabular-nums;

  content: counter(websearch-citation) '.';
  color: var(--muted-foreground);
}

.websearch-citation {
  @apply break-all no-underline;

  color: var(--primary-solid);
}

.websearch-citation:hover,
.websearch-citation:focus-visible {
  @apply underline;
}

.websearch-citation-source {
  @apply ml-1.5;

  color: var(--muted-foreground);
}

.websearch-citation-description {
  @apply line-clamp-2 pl-4;
}

.websearch-citations-toggle {
  @apply w-fit cursor-pointer border-0 bg-transparent p-0 text-xs outline-none transition-colors duration-150;

  color: var(--muted-foreground);
}

.websearch-citations-toggle:hover,
.websearch-citations-toggle:focus-visible {
  color: var(--foreground);
}
</style>
