<script setup lang="ts">
import { computed, nextTick, ref, watch, type ComponentPublicInstance } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppScrollArea } from '@/components/AppScrollArea';

import {
  projectReviewLaneIssues,
  type ProjectedReviewIssue,
  type ReviewLaneKey,
  type ReviewLaneState,
  type ReviewLaneStatus
} from '../composables/useReviewLanes';
import ReviewIssueList from './ReviewIssueList.vue';

const props = defineProps<{
  lanes: ReviewLaneState[];
}>();

const emit = defineEmits<{
  retryRead: [key: ReviewLaneKey];
  cancel: [key: ReviewLaneKey];
  dismiss: [key: ReviewLaneKey];
}>();

const laneLabels: Record<ReviewLaneKey, string> = {
  continuity: '连贯性',
  character: '人物',
  style: '文风'
};

const REVIEW_TAB_ID_PREFIX = 'reviews-tab';
const REVIEW_PANEL_ID_PREFIX = 'reviews-panel';

const activeKey = ref<ReviewLaneKey>('continuity');
const open = ref(true);
const tabRefs = ref<Partial<Record<ReviewLaneKey, HTMLButtonElement | null>>>({});
const visible = computed(() => props.lanes.some(lane => lane.status !== 'idle'));
const laneKeys = computed(() => props.lanes.map(lane => lane.key));
const activeLane = computed(() => props.lanes.find(lane => lane.key === activeKey.value) ?? props.lanes[0]);
const activeIssues = computed<ProjectedReviewIssue[]>(() =>
  activeLane.value ? projectReviewLaneIssues(activeLane.value) : []
);

watch(
  visible,
  value => {
    open.value = value;
  },
  { immediate: true }
);

watch(
  () => props.lanes.map(lane => lane.status).join('|'),
  () => {
    const current = props.lanes.find(lane => lane.key === activeKey.value);
    if (!current || current.status === 'idle') {
      activeKey.value = props.lanes.find(lane => lane.status !== 'idle')?.key ?? 'continuity';
    }
  },
  { immediate: true }
);

function laneLabel(key: ReviewLaneKey) {
  return laneLabels[key];
}

function tabId(key: ReviewLaneKey) {
  return `${REVIEW_TAB_ID_PREFIX}-${key}`;
}

function panelId(key: ReviewLaneKey) {
  return `${REVIEW_PANEL_ID_PREFIX}-${key}`;
}

function setTabRef(key: ReviewLaneKey, element: Element | ComponentPublicInstance | null) {
  tabRefs.value[key] = element instanceof HTMLButtonElement ? element : null;
}

function activateLane(key: ReviewLaneKey, moveFocus = false) {
  activeKey.value = key;

  if (moveFocus) {
    void nextTick(() => {
      tabRefs.value[key]?.focus();
    });
  }
}

function handleTabKeydown(event: KeyboardEvent, key: ReviewLaneKey) {
  const keys = laneKeys.value;
  const currentIndex = keys.indexOf(key);

  if (currentIndex === -1 || keys.length === 0) {
    return;
  }

  let targetIndex: number | null = null;

  switch (event.key) {
    case 'ArrowRight':
      targetIndex = (currentIndex + 1) % keys.length;
      break;
    case 'ArrowLeft':
      targetIndex = (currentIndex - 1 + keys.length) % keys.length;
      break;
    case 'Home':
      targetIndex = 0;
      break;
    case 'End':
      targetIndex = keys.length - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  activateLane(keys[targetIndex], true);
}

function tabBadge(lane: ReviewLaneState) {
  switch (lane.status) {
    case 'done':
      return `${lane.result?.issues.length ?? 0}`;
    case 'failed':
    case 'read-failed':
      return '错误';
    case 'running':
      return '运行中';
    case 'reading':
      return '读取中';
    case 'cancelled':
      return '已取消';
    case 'idle':
      return '待审查';
  }
}

function statusText(lane: ReviewLaneState) {
  switch (lane.status) {
    case 'running':
      return `正在审查${laneLabel(lane.key)}……`;
    case 'reading':
      return `正在读取${laneLabel(lane.key)}结果……`;
    case 'done':
      return lane.result?.issues.length ? `发现 ${lane.result.issues.length} 个问题` : '未发现问题';
    case 'failed':
      return `${laneLabel(lane.key)}审查失败`;
    case 'read-failed':
      return `${laneLabel(lane.key)}结果读取失败`;
    case 'cancelled':
      return `${laneLabel(lane.key)}审查已取消`;
    case 'idle':
      return `${laneLabel(lane.key)}待审查`;
  }
}

function statusIcon(status: ReviewLaneStatus) {
  switch (status) {
    case 'running':
    case 'reading':
      return 'i-mingcute-loading-3-line animate-spin';
    case 'done':
      return 'i-mingcute-check-circle-fill text-primary';
    case 'failed':
    case 'read-failed':
      return 'i-mingcute-warning-line';
    case 'cancelled':
      return 'i-mingcute-close-circle-line';
    case 'idle':
      return 'i-mingcute-time-line';
  }
}
</script>

<template>
  <section v-if="visible" class="review-strip" aria-label="三维审查结果">
    <AppCollapsible v-model="open" class="review-strip-collapsible" content-class="review-strip-content">
      <template #trigger="{ open: isOpen }">
        <button type="button" class="review-strip-trigger">
          <span class="i-mingcute-eye-line size-4 shrink-0" aria-hidden="true" />
          <span class="review-strip-title">三维审查结果</span>
          <span
            :class="['size-4 shrink-0 review-strip-chevron', isOpen ? 'i-mingcute-down-line' : 'i-mingcute-up-line']"
            aria-hidden="true"
          />
        </button>
      </template>

      <div class="review-tabs" role="tablist" aria-label="审查维度">
        <button
          v-for="lane in props.lanes"
          :key="lane.key"
          :ref="element => setTabRef(lane.key, element)"
          type="button"
          class="review-lane-tab"
          :class="lane.key === activeKey && 'review-lane-tab-active'"
          :id="tabId(lane.key)"
          role="tab"
          :aria-controls="panelId(lane.key)"
          :aria-selected="lane.key === activeKey ? 'true' : 'false'"
          :tabindex="lane.key === activeKey ? 0 : -1"
          @click="activateLane(lane.key)"
          @keydown="handleTabKeydown($event, lane.key)"
        >
          <span>{{ laneLabel(lane.key) }}</span>
          <span class="review-lane-badge">{{ tabBadge(lane) }}</span>
        </button>
      </div>

      <div
        v-if="activeLane"
        class="review-lane-panel"
        :id="panelId(activeLane.key)"
        role="tabpanel"
        :aria-labelledby="tabId(activeLane.key)"
      >
        <div class="review-lane-head">
          <span :class="['size-4 shrink-0', statusIcon(activeLane.status)]" aria-hidden="true" />
          <span class="review-lane-status">{{ statusText(activeLane) }}</span>
          <AppButton
            v-if="activeLane.status === 'running'"
            variant="ghost"
            size="xs"
            type="button"
            :aria-label="`取消${laneLabel(activeLane.key)}审查`"
            @click="emit('cancel', activeLane.key)"
          >
            取消
          </AppButton>
          <AppButton
            v-else-if="activeLane.status !== 'idle'"
            variant="ghost"
            size="xs"
            type="button"
            :aria-label="`关闭${laneLabel(activeLane.key)}结果`"
            @click="emit('dismiss', activeLane.key)"
          >
            清除
          </AppButton>
        </div>

        <template v-if="activeLane.status === 'done'">
          <p v-if="activeLane.result" class="review-summary">{{ activeLane.result.summary }}</p>
          <AppScrollArea v-if="activeIssues.length > 0" class="review-issue-scroll">
            <ReviewIssueList :issues="activeIssues" />
          </AppScrollArea>
        </template>

        <template v-else-if="activeLane.status === 'failed' || activeLane.status === 'read-failed'">
          <ul class="review-error-list">
            <li v-for="(error, index) in activeLane.errors" :key="index">{{ error }}</li>
          </ul>
          <AppButton
            v-if="activeLane.status === 'read-failed'"
            variant="ghost"
            size="xs"
            type="button"
            :aria-label="`重试读取${laneLabel(activeLane.key)}结果`"
            @click="emit('retryRead', activeLane.key)"
          >
            重试读取
          </AppButton>
        </template>
      </div>
    </AppCollapsible>
  </section>
</template>

<style scoped lang="scss">
.review-strip {
  @apply text-sm;
}

.review-strip-collapsible {
  // 内容向上展开，折叠行贴近输入框。
  @apply flex flex-col-reverse;
}

.review-strip-trigger {
  @apply flex w-full items-center gap-2 border-0 bg-transparent px-3 py-1.5 text-left outline-none;

  color: var(--foreground);

  &:hover {
    background: var(--surface-hover);
  }
}

.review-strip-title {
  @apply min-w-0 flex-1 truncate font-medium;
}

.review-strip-chevron {
  color: var(--muted-foreground);
}

:deep(.review-strip-content) {
  @apply px-3 py-2;

  border-bottom: 1px solid var(--border-subtle);
}

.review-tabs {
  @apply flex items-center gap-1;
}

.review-lane-tab {
  @apply inline-flex min-w-0 flex-1 items-center justify-center gap-1 rounded-md border px-2 py-1 text-xs font-medium;

  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.review-lane-tab-active {
  background: var(--surface-hover);
  color: var(--foreground);
}

.review-lane-badge {
  @apply rounded px-1.5 py-0.5 text-[0.65rem] leading-none;

  background: var(--surface-acrylic-strong);
}

.review-lane-panel {
  @apply mt-2 space-y-2;
}

.review-lane-head {
  @apply flex items-center gap-2;
}

.review-lane-status {
  @apply min-w-0 flex-1 truncate font-medium;
}

.review-summary {
  @apply text-foreground;
}

.review-issue-scroll {
  @apply max-h-36;
}

.review-error-list {
  @apply m-0 list-disc space-y-1 pl-5 text-xs;

  color: var(--muted-foreground);
}
</style>
