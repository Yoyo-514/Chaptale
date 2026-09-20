<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { REVIEW_ISSUE_LABELS } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel, AppPanelSection } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useRunStore } from '@/features/runs';
import { useWorkbenchStore } from '@/features/workbench';
import { useWritingStore } from '@/features/writing';

import { useReviewStore } from '../store';
import ReviewConfirmation from './ReviewConfirmation.vue';
import ReviewFeedback from './ReviewFeedback.vue';
const reviews = useReviewStore();
const writing = useWritingStore();
const runs = useRunStore();
const navigation = useWorkbenchStore();
const list = ref<HTMLElement | null>(null);
const selectedIssues = ref<number[]>([]);
const labels = { running: '运行中', done: '已完成', failed: '失败', cancelled: '已取消' };
const severityLabels: Record<string, string> = { high: '高', medium: '中', low: '低' };
const job = computed(() => reviews.details?.job);
const typeLabels = REVIEW_ISSUE_LABELS;
const openCount = computed(() => reviews.issues.filter(value => value.status === 'open').length);
const subtitle = computed(() =>
  job.value
    ? `${job.value.targetPath} · ${job.value.candidateId ? '候选稿' : '已保存正文'}`
    : reviews.running.length
      ? `${reviews.running.length} 项审查运行中`
      : '尚未选择审查记录'
);
function runningFor(personaId: string) {
  return reviews.running.filter(value => value.personaId === personaId);
}
watch(
  () => reviews.details,
  () => {
    selectedIssues.value = selectedIssues.value.filter(index => reviews.issues[index]?.status === 'open');
  }
);
watch(
  () => job.value?.id,
  () => {
    selectedIssues.value = [];
  }
);
watch(
  () => reviews.selectedIssue,
  async index => {
    await nextTick();
    list.value?.querySelector(`[data-review-index="${index}"]`)?.scrollIntoView({ block: 'nearest' });
  }
);
onMounted(() => {
  void reviews.refresh();
});
async function locate(index: number) {
  await reviews.locate(index);
  if (job.value?.candidateId) await writing.read(job.value.candidateId);
}
</script>
<template>
  <AppPanel class="review-panel" title="独立审查" title-hidden :subtitle="subtitle">
    <template #actions>
      <AppButton size="xs" variant="primary" @click="reviews.prepare()">运行审查</AppButton>
      <AppTooltip text="打开审查中心" side="bottom" :side-offset="3">
        <AppButton icon size="xs" variant="ghost" aria-label="打开审查中心" @click="navigation.showSidebar('review')">
          <span class="i-mingcute-list-check-line" />
        </AppButton>
      </AppTooltip>
    </template>

    <AppPanelSection title="审查专员" :count="reviews.reviewers.length" :open="!job">
      <div v-for="reviewer in reviews.reviewers" :key="reviewer.id" class="review-lane">
        <span class="i-mingcute-user-3-line size-4 shrink-0 review-lane-icon" aria-hidden="true" />
        <span class="review-lane-label">{{ reviewer.label }}</span>
        <template v-if="runningFor(reviewer.id).length">
          <span class="review-lane-running" role="status">
            <span class="i-mingcute-loading-3-line animate-spin size-3.5" aria-hidden="true" />运行中
          </span>
          <AppButton
            v-for="active in runningFor(reviewer.id)"
            :key="active.id"
            size="xs"
            variant="ghost"
            @click="reviews.cancel(active.id)"
          >
            取消
          </AppButton>
        </template>
        <AppButton v-else size="xs" variant="ghost" @click="reviews.prepare(reviewer.id)">运行</AppButton>
      </div>
      <p v-if="!reviews.reviewers.length" class="review-empty">没有已启用的审查专员，可在设置「专员与内容」里启用。</p>
    </AppPanelSection>

    <div class="review-selection">
      <AppSelect
        :model-value="job?.id"
        placeholder="选择审查记录"
        aria-label="审查记录"
        @update:model-value="reviews.read"
      >
        <AppSelectItem v-for="item in reviews.jobs" :key="item.id" :value="item.id">
          {{ reviews.reviewerLabel(item.personaId, item.personaName) }} · {{ item.targetPath }} ·
          {{ labels[item.status] }} · {{ item.id.slice(0, 8) }}
        </AppSelectItem>
      </AppSelect>
    </div>
    <AppNotice v-if="reviews.error || writing.error || job?.error" tone="error">
      {{ reviews.error || writing.error || job?.error }}
    </AppNotice>
    <AppNotice v-if="reviews.needsRereview" tone="warning">超过半数未处理问题已失锚，建议重新审查。</AppNotice>
    <ReviewFeedback />

    <AppEmptyState
      v-if="!job && !reviews.running.length"
      icon="i-mingcute-check-circle-line"
      title="还没有审查结果"
      description="对已保存的正文运行审查，问题会附带原文定位与修订入口。"
    />
    <template v-if="job">
      <AppNotice v-if="reviews.details?.result" tone="info">{{ reviews.details.result.summary }}</AppNotice>
      <AppNotice v-if="job.excludedSources.length" tone="warning"
        >未发送待确认观察：{{ job.excludedSources.join('、') }}</AppNotice
      >
      <AppPanelSection v-if="reviews.details?.result" title="问题" :count="openCount" heading>
        <div class="issue-filters">
          <AppSelect v-model="reviews.severity" aria-label="问题严重度" content-size="sm">
            <AppSelectItem value="all">全部严重度</AppSelectItem>
            <AppSelectItem v-for="(label, key) in severityLabels" :key="key" :value="key">{{ label }}</AppSelectItem>
          </AppSelect>
          <AppSelect v-model="reviews.issueType" aria-label="问题类型" content-size="sm">
            <AppSelectItem value="all">全部类型</AppSelectItem>
            <AppSelectItem
              v-for="kind in [...new Set(reviews.issues.map(value => value.issue.type))]"
              :key="kind"
              :value="kind"
            >
              {{ typeLabels[kind] ?? kind }}
            </AppSelectItem>
          </AppSelect>
          <AppSelect v-model="reviews.issueStatus" aria-label="问题处理状态" content-size="sm">
            <AppSelectItem value="all">全部问题</AppSelectItem>
            <AppSelectItem value="open">未处理</AppSelectItem>
            <AppSelectItem value="resolved">已处理</AppSelectItem>
            <AppSelectItem value="ignored">已忽略</AppSelectItem>
          </AppSelect>
        </div>
        <div ref="list" class="review-results">
          <p v-if="!reviews.visibleIssues.length" class="review-empty">没有符合筛选条件的问题</p>
          <article
            v-for="value in reviews.visibleIssues"
            :key="value.index"
            :data-review-index="value.index"
            class="review-issue-row"
            :class="[
              `is-${value.issue.severity}`,
              { selected: reviews.selectedIssue === value.index, 'is-stale': value.anchor.stale }
            ]"
          >
            <div class="issue-heading">
              <AppCheckbox
                :model-value="selectedIssues.includes(value.index)"
                :aria-label="`选择问题 ${value.index + 1}`"
                :disabled="value.status !== 'open' || value.anchor.stale"
                @update:model-value="
                  selectedIssues =
                    $event === true
                      ? [...new Set([...selectedIssues, value.index])]
                      : selectedIssues.filter(index => index !== value.index)
                "
              />
              <span class="issue-severity">{{ severityLabels[value.issue.severity] }}</span>
              <strong class="issue-type">{{ typeLabels[value.issue.type] ?? value.issue.type }}</strong>
              <span v-if="value.status !== 'open'" class="issue-state">{{
                value.status === 'resolved' ? '已处理' : '已忽略'
              }}</span>
              <span v-if="value.anchor.stale" class="issue-state issue-stale">原文已变化</span>
            </div>
            <AppButton variant="link" class="issue-quote" :disabled="value.anchor.stale" @click="locate(value.index)">
              {{ value.issue.quote }}
            </AppButton>
            <p class="issue-text">{{ value.issue.reason }}</p>
            <p class="issue-text issue-suggestion">{{ value.issue.suggestion }}</p>
            <p v-if="value.issue.agentType === 'character'" class="issue-text">{{ value.issue.expectedBehavior }}</p>
            <div class="issue-actions">
              <AppButton
                v-if="value.status === 'open'"
                size="xs"
                :disabled="value.anchor.stale"
                @click="writing.prepareRewrite(job!.id, [value.index])"
              >
                提出修订
              </AppButton>
              <AppButton size="xs" variant="ghost" :disabled="value.anchor.stale" @click="locate(value.index)"
                >定位</AppButton
              >
              <AppButton
                v-if="value.status !== 'resolved'"
                size="xs"
                variant="ghost"
                @click="reviews.resolve([value.index], 'resolved')"
              >
                已处理
              </AppButton>
              <AppButton
                v-if="value.status !== 'ignored'"
                size="xs"
                variant="ghost"
                @click="reviews.resolve([value.index], 'ignored')"
              >
                忽略
              </AppButton>
              <AppButton
                v-if="value.status !== 'open'"
                size="xs"
                variant="ghost"
                @click="reviews.resolve([value.index], 'open')"
              >
                重新打开
              </AppButton>
            </div>
          </article>
        </div>
      </AppPanelSection>
    </template>

    <template v-if="job" #footer>
      <AppButton v-if="job.runId" size="xs" variant="ghost" @click="runs.open(job.runId)">查看运行</AppButton>
      <AppButton
        v-if="reviews.issueType !== 'all' && reviews.visibleIssues.length"
        size="xs"
        variant="ghost"
        @click="
          reviews.resolve(
            reviews.visibleIssues.map(value => value.index),
            'ignored'
          )
        "
      >
        忽略此类问题
      </AppButton>
      <AppButton size="xs" @click="reviews.prepare(job.personaId)">重新审查正文</AppButton>
      <AppButton
        size="xs"
        variant="primary"
        :disabled="!selectedIssues.length"
        @click="writing.prepareRewrite(job.id, [...selectedIssues])"
      >
        修订所选 ({{ selectedIssues.length }})
      </AppButton>
    </template>
  </AppPanel>
  <ReviewConfirmation />
</template>
<style scoped lang="scss">
.review-lane {
  @apply flex h-8 items-center gap-2 pl-5 pr-2;
}
.review-lane-icon {
  color: var(--muted-foreground);
}
.review-lane-label {
  @apply min-w-0 flex-1 truncate;
}
.review-lane-running {
  @apply flex items-center gap-1;
  color: var(--primary-solid);
  font-size: var(--ui-caption-size);
}
.review-empty {
  @apply m-0 px-5 py-2;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  overflow-wrap: anywhere;
}
.review-selection {
  @apply px-3 py-2;
}
.issue-filters {
  @apply grid gap-2 px-3 pb-2 pt-1;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 7rem), 1fr));
}
.review-issue-row {
  @apply relative flex flex-col gap-1 py-2 pl-3 pr-3;
  border-top: 1px solid var(--border-subtle);
  overflow-wrap: anywhere;
}
.review-issue-row.selected {
  background: var(--accent);
}
.review-issue-row.is-stale {
  color: var(--muted-foreground);
}
.issue-heading {
  @apply flex flex-wrap items-center gap-x-2 gap-y-1;
}
.issue-severity {
  @apply rounded px-1.5 leading-5;
  font-size: var(--ui-caption-size);
  background: var(--surface-muted);
  color: var(--muted-foreground);
}
.review-issue-row.is-high .issue-severity {
  background: var(--destructive-background);
  color: var(--destructive-background-foreground);
}
.review-issue-row.is-medium .issue-severity {
  background: var(--accent-sakura);
  color: var(--accent-sakura-foreground);
}
.issue-type {
  @apply font-medium;
}
.issue-state {
  @apply ml-auto;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.issue-stale {
  color: var(--warning);
}
.issue-quote {
  @apply w-full justify-start border-0 bg-transparent p-0 text-left;
  color: var(--foreground);
  overflow-wrap: anywhere;
}
.issue-quote:disabled {
  color: var(--muted-foreground);
}
.issue-text {
  @apply m-0;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  line-height: 1.6;
}
.issue-suggestion {
  color: var(--foreground);
}
.issue-actions {
  @apply flex flex-wrap gap-1 pt-1;
}
</style>
