<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { RecordList } from '@/features/records';

import EntryReview from './EntryReview.vue';
import { type ReviewTab, useReviewStore } from './store';

/** 审阅标签：条目自身的修改在上方，资料涉及的事件候选在下方逐条处理。 */
const props = defineProps<{ tab: ReviewTab }>();
const review = useReviewStore();
const done = computed(() => !props.tab.review && !props.tab.records.length);
const next = computed(() => (done.value ? review.nextResource(props.tab) : null));
</script>

<template>
  <div class="review-tab" :class="{ 'review-records-only': !tab.review }">
    <EntryReview v-if="tab.review" :tab="tab" />
    <header v-else class="review-tab-header">
      <span class="review-tab-title">{{ tab.title }}</span>
      <span v-if="done" class="review-tab-meta">本资料的修改已处理完</span>
      <span class="flex-1" />
      <AppButton v-if="next" size="sm" variant="primary" @click="review.openNext(tab.key)"
        >下一份：{{ next.title }}</AppButton
      >
    </header>
    <p v-if="!tab.review && tab.error" class="review-tab-error" role="alert">{{ tab.error }}</p>
    <RecordList
      v-if="tab.section === 'resource' && (tab.records.length || !tab.review)"
      :work-id="tab.workId"
      :resource-id="tab.entryId"
      :candidates="tab.records"
      :busy="tab.busy"
      @decide="(change, decision) => review.decideRecord(tab.key, change, decision)"
      @update="(change, fields) => review.updateRecord(tab.key, change, fields)"
    />
  </div>
</template>

<style scoped>
.review-tab {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  min-height: 0;
}
.review-records-only :deep(.records-scroll) {
  max-height: none;
}
.review-tab-header {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 4px 12px 4px 16px;
  border-bottom: 1px solid var(--border-subtle);
}
.review-tab-title {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.review-tab-meta {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.review-tab-error {
  margin: 0;
  padding: 6px 16px;
  color: var(--destructive);
  font-size: 13px;
}
</style>
