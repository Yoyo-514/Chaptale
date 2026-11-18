<script setup lang="ts">
import { computed, ref } from 'vue';

import type { ReviewItem } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { useCreationStore } from '@/features/creation';
import { useReviewStore } from '@/features/editor';

import { useAgentStore } from '../store';

const agent = useAgentStore();
const review = useReviewStore();
const creation = useCreationStore();
const detailsOpen = ref(false);
const sessionId = computed(() => agent.active?.sessionId ?? null);
const items = computed(() => (sessionId.value ? (review.summaries[sessionId.value] ?? []) : []));
const count = computed(() => items.value.reduce((sum, item) => sum + item.count, 0));
const busy = computed(() => (sessionId.value ? Boolean(review.batchBusy[sessionId.value]) : false));
const error = computed(() => (sessionId.value ? review.batchErrors[sessionId.value] : ''));

/** 卡片中的一行：文稿按条目列出；资料自身的修改与涉及它的事件合为一行，事件计在第一份资料下。 */
interface ReviewRow {
  key: string;
  workId: string;
  entryId: string;
  label: string;
  title: string;
  records: number;
  relations: number;
  conflicted: boolean;
}
function entryLabel(item: Extract<ReviewItem, { title: string }>) {
  if (item.deleted) return item.kind === 'directory' ? '删除目录' : '删除';
  if (item.created) return item.kind === 'directory' ? '新建目录' : '新建';
  return item.section === 'resource' ? '资料' : '文稿';
}
function rows(list: ReviewItem[]): ReviewRow[] {
  const grouped = new Map<string, ReviewRow>();
  const titles = new Map(list.flatMap(item => ('title' in item ? [[item.targetId, item.title] as const] : [])));
  // 事件归第一份涉及的资料；关系在双方资料下各计一条。
  const placements = list.flatMap((item): { item: ReviewItem; entryId: string }[] =>
    item.kind === 'record'
      ? [{ item, entryId: item.record.resourceIds[0] }]
      : item.kind === 'relation'
        ? item.relation.resourceIds.map(entryId => ({ item, entryId }))
        : [{ item, entryId: item.targetId }]
  );
  for (const { item, entryId } of placements) {
    const key = `${item.workId}:${entryId}`;
    const row = grouped.get(key) ?? {
      key,
      workId: item.workId,
      entryId,
      label: '资料',
      title:
        titles.get(entryId) ??
        creation.entries.find(entry => entry.id === entryId)?.title ??
        creation.pendingEntries.find(change => change.targetId === entryId)?.candidate.title ??
        '',
      records: 0,
      relations: 0,
      conflicted: false
    };
    if (item.kind === 'record') row.records += 1;
    else if (item.kind === 'relation') row.relations += 1;
    else row.label = entryLabel(item);
    row.conflicted ||= item.conflicted;
    grouped.set(key, row);
  }
  return [...grouped.values()];
}
function workTitle(row: ReviewRow) {
  return creation.works.find(work => work.id === row.workId)?.title ?? '其他作品';
}
function view(row: ReviewRow) {
  void review.reveal({ sessionId: sessionId.value!, entryId: row.entryId });
}
</script>

<template>
  <div v-if="items.length" class="review-dock">
    <section class="review-card agent-column" aria-label="待接受修改">
      <header class="review-header">
        <button type="button" class="review-summary" :aria-expanded="detailsOpen" @click="detailsOpen = !detailsOpen">
          <span
            :class="detailsOpen ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />
          <span class="review-heading">等你处理 {{ count }} 处修改</span>
        </button>
        <AppButton size="xs" variant="ghost" :disabled="busy" @click="review.decideAll(sessionId!, 'reject')"
          >全部拒绝</AppButton
        >
        <AppButton size="xs" variant="primary" :disabled="busy" @click="review.decideAll(sessionId!, 'accept')"
          >全部接受</AppButton
        >
      </header>
      <ul v-if="detailsOpen" class="review-items">
        <li v-for="row in rows(items)" :key="row.key" class="review-item">
          <span class="review-kind">{{ row.label }}</span>
          <span class="review-title" :title="row.title">{{ row.title }}</span>
          <span v-if="row.records" class="review-count">{{ row.records }} 条事件</span>
          <span v-if="row.relations" class="review-count">{{ row.relations }} 条关系</span>
          <span v-if="row.conflicted" class="review-flag" title="正式稿在修改期间也有变化">冲突</span>
          <AppButton v-if="row.workId === creation.workId" size="xs" variant="ghost" @click="view(row)">查看</AppButton>
          <span v-else class="review-other" :title="`在《${workTitle(row)}》中，打开该作品后查看`">{{
            workTitle(row)
          }}</span>
        </li>
      </ul>
      <p v-if="error" class="review-error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
/* 输入框上方的独立浮卡，与输入框同宽、同圆角，留出间距。 */
.review-dock {
  flex-shrink: 0;
  padding: 4px 16px 2px;
}
.review-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: calc(var(--radius-overlay) * 2);
  background: var(--popover);
  box-shadow: var(--shadow-float);
  font-size: var(--ui-font-size);
}
.review-count {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.review-header {
  display: flex;
  align-items: center;
  gap: 4px;
}
.review-summary {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 4px;
  min-width: 0;
  min-height: 24px;
  padding: 0 2px;
  border: 0;
  border-radius: var(--radius-control-sm);
  background: none;
  color: var(--foreground);
  font: inherit;
  text-align: left;
  cursor: pointer;
}
.review-heading {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-items {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 0 0 20px;
  list-style: none;
}
.review-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
}
.review-kind,
.review-other {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.review-other {
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-flag {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  font-size: var(--ui-caption-size);
}
.review-error {
  margin: 0;
  color: var(--destructive);
  white-space: pre-line;
}
</style>
