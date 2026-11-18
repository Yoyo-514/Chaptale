<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';
import { StoryPanel } from '@/features/story';

import { useCheckStore } from '../check/store';
import EntryReview from './EntryReview.vue';
import { type ReviewTab, reviewDone, useReviewStore } from './store';

/** 审阅标签：条目自身的修改在上方，资料涉及的关系与事件候选在下方逐条处理。 */
const props = defineProps<{ tab: ReviewTab }>();
const review = useReviewStore();
const check = useCheckStore();
const done = computed(() => reviewDone(props.tab));
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
    <StoryPanel
      v-if="tab.section === 'resource' && (tab.records.length || tab.relations.length || !tab.review)"
      :work-id="tab.workId"
      :resource-id="tab.entryId"
      :changed-sources="check.changedIds"
      :candidates="{ records: tab.records, relations: tab.relations, waiting: tab.waiting }"
      :busy="tab.busy"
      @decide="(change, decision) => review.decideStory(tab.key, change, decision)"
      @update-record="(change, fields) => review.updateRecord(tab.key, change, fields)"
      @update-relation="(change, input) => review.updateRelation(tab.key, change, input)"
      @source="entryId => review.reveal({ sessionId: tab.sessionId, entryId })"
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
.review-records-only :deep(.story-scroll) {
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
  font-size: var(--ui-font-size);
}
</style>
