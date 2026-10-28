<script setup lang="ts">
import { computed, ref } from 'vue';

import type { DeliveryItem, DeliverySummary } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { useCreationStore } from '@/features/creation';
import { useReviewStore } from '@/features/editor';

import { useAgentStore } from '../store';

const agent = useAgentStore();
const review = useReviewStore();
const creation = useCreationStore();
const historyOpen = ref(false);
const detailsOpen = ref(false);
const sessionId = computed(() => agent.active?.sessionId ?? null);
const list = computed(() => (sessionId.value ? (review.summaries[sessionId.value] ?? []) : []));
const current = computed(() => list.value.find(summary => summary.group.status === 'pending' && summary.items.length));
const earlier = computed(() =>
  list.value.filter(summary => summary.group.status !== 'pending' && summary.items.length)
);
const busy = computed(() => (sessionId.value ? Boolean(review.deliveryBusy[sessionId.value]) : false));
const error = computed(() => (sessionId.value ? review.deliveryErrors[sessionId.value] : ''));
const earlierCount = computed(() => earlier.value.reduce((sum, summary) => sum + summary.items.length, 0));

function label(item: DeliveryItem) {
  if (item.deleted) return item.kind === 'directory' ? '删除目录' : '删除';
  if (item.created) return item.kind === 'directory' ? '新建目录' : '新建';
  return item.section === 'resource' ? '资料' : '文稿';
}
function workTitle(item: DeliveryItem) {
  return creation.works.find(work => work.id === item.workId)?.title ?? '其他作品';
}
function view(summary: DeliverySummary, item: DeliveryItem) {
  void review.reveal({
    id: item.target.changeId,
    sessionId: summary.group.sessionId,
    workId: item.workId,
    entryId: item.entryId,
    title: item.title
  });
}
</script>

<template>
  <div v-if="current || earlier.length" class="delivery-dock">
    <section class="delivery-card agent-column" aria-label="待接受修改">
      <template v-if="current">
        <header class="delivery-header">
          <button
            type="button"
            class="delivery-summary"
            :aria-expanded="detailsOpen"
            :title="agent.active?.waitingForReview ? '处理完任务会继续' : undefined"
            @click="detailsOpen = !detailsOpen"
          >
            <span
              :class="detailsOpen ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
              class="size-3.5 shrink-0"
              aria-hidden="true"
            />
            <span class="delivery-heading">{{
              agent.active?.waitingForReview
                ? `等你处理 ${current.items.length} 处修改`
                : `${current.items.length} 处修改待接受`
            }}</span>
          </button>
          <AppButton size="xs" variant="ghost" :disabled="busy" @click="review.decideGroup(current, 'reject')"
            >全部拒绝</AppButton
          >
          <AppButton size="xs" variant="primary" :disabled="busy" @click="review.decideGroup(current, 'accept')"
            >全部接受</AppButton
          >
        </header>
        <template v-if="detailsOpen">
          <ul class="delivery-items">
            <li v-for="item in current.items" :key="item.target.changeId" class="delivery-item">
              <span class="delivery-kind">{{ label(item) }}</span>
              <span class="delivery-title" :title="item.title">{{ item.title }}</span>
              <span v-if="item.conflicted" class="delivery-flag" title="正式稿在修改期间也有变化">冲突</span>
              <AppButton v-if="item.workId === creation.workId" size="xs" variant="ghost" @click="view(current, item)"
                >查看</AppButton
              >
              <span v-else class="delivery-other" :title="`在《${workTitle(item)}》中，打开该作品后查看`">{{
                workTitle(item)
              }}</span>
            </li>
          </ul>
          <div class="delivery-actions">
            <AppButton
              size="xs"
              variant="ghost"
              :disabled="busy || Boolean(agent.active?.running)"
              :title="agent.active?.running ? '任务运行中，停止后才能结束' : '剩余修改留作早前任务的待审，不再自动继续'"
              @click="review.endTask(current)"
              >结束当前任务</AppButton
            >
          </div>
        </template>
      </template>
      <template v-if="earlier.length">
        <button type="button" class="delivery-toggle" :aria-expanded="historyOpen" @click="historyOpen = !historyOpen">
          <span
            :class="historyOpen ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
            class="size-3.5 shrink-0"
            aria-hidden="true"
          />早前任务还有 {{ earlierCount }} 处修改待处理
        </button>
        <div v-for="summary in historyOpen ? earlier : []" :key="summary.group.id" class="delivery-group">
          <ul class="delivery-items">
            <li v-for="item in summary.items" :key="item.target.changeId" class="delivery-item">
              <span class="delivery-kind">{{ label(item) }}</span>
              <span class="delivery-title" :title="item.title">{{ item.title }}</span>
              <span v-if="item.conflicted" class="delivery-flag" title="正式稿在修改期间也有变化">冲突</span>
              <AppButton v-if="item.workId === creation.workId" size="xs" variant="ghost" @click="view(summary, item)"
                >查看</AppButton
              >
              <span v-else class="delivery-other" :title="`在《${workTitle(item)}》中，打开该作品后查看`">{{
                workTitle(item)
              }}</span>
            </li>
          </ul>
          <div class="delivery-actions">
            <span class="flex-1" />
            <AppButton size="xs" variant="ghost" :disabled="busy" @click="review.decideGroup(summary, 'reject')"
              >全部拒绝</AppButton
            >
            <AppButton size="xs" variant="ghost" :disabled="busy" @click="review.decideGroup(summary, 'accept')"
              >全部接受</AppButton
            >
          </div>
        </div>
      </template>
      <p v-if="error" class="delivery-error" role="alert">{{ error }}</p>
    </section>
  </div>
</template>

<style scoped>
/* 输入框上方的独立浮卡，与输入框同宽、同圆角，留出间距。 */
.delivery-dock {
  flex-shrink: 0;
  padding: 4px 16px 2px;
}
.delivery-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 6px 8px 6px 10px;
  border: 1px solid var(--border-subtle);
  border-radius: calc(var(--radius-overlay) * 2);
  background: var(--popover);
  box-shadow: var(--shadow-float);
  font-size: 13px;
}
.delivery-header {
  display: flex;
  align-items: center;
  gap: 4px;
}
.delivery-summary {
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
.delivery-summary:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 1px;
}
.delivery-heading {
  overflow: hidden;
  font-weight: 500;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.delivery-items {
  display: flex;
  flex-direction: column;
  margin: 0;
  padding: 0 0 0 20px;
  list-style: none;
}
.delivery-item {
  display: flex;
  align-items: center;
  gap: 6px;
  min-height: 26px;
}
.delivery-kind,
.delivery-other {
  flex-shrink: 0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.delivery-other {
  max-width: 40%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.delivery-title {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.delivery-flag {
  flex-shrink: 0;
  padding: 0 4px;
  border-radius: var(--radius-control-sm);
  background: color-mix(in srgb, var(--warning) 18%, transparent);
  font-size: var(--ui-caption-size);
}
.delivery-actions {
  display: flex;
  align-items: center;
  gap: 4px;
}
.delivery-toggle {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 2px 0;
  border: 0;
  background: none;
  color: var(--muted-foreground);
  font: inherit;
  font-size: var(--ui-caption-size);
  cursor: pointer;
}
.delivery-toggle:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: 2px;
}
.delivery-group + .delivery-group {
  padding-top: 6px;
  border-top: 1px solid var(--border-subtle);
}
.delivery-error {
  margin: 0;
  color: var(--destructive);
  white-space: pre-line;
}
</style>
