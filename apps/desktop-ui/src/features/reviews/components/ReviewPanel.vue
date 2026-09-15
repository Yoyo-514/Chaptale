<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { REVIEW_ISSUE_LABELS } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppPanel } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
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
  <AppPanel class="review-panel" title="独立审查">
    <template #actions>
      <AppButton size="xs" @click="reviews.prepare()">运行审查</AppButton
      ><AppButton
        icon
        size="xs"
        variant="ghost"
        aria-label="打开审查中心"
        title="打开审查中心"
        @click="navigation.showSidebar('review')"
        ><span class="i-mingcute-list-check-line size-3.5"
      /></AppButton>
    </template>
    <div class="review-lanes">
      <div v-for="reviewer in reviews.reviewers" :key="reviewer.id" class="review-lane">
        <span>{{ reviewer.label }}</span>
        <AppButton size="xs" variant="ghost" @click="reviews.prepare(reviewer.id)">运行</AppButton>
        <div
          v-for="active in reviews.running.filter(value => value.personaId === reviewer.id)"
          :key="active.id"
          class="review-running"
        >
          <span role="status">运行中</span><AppButton size="xs" @click="reviews.cancel(active.id)">取消</AppButton>
        </div>
      </div>
    </div>
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
    <p v-if="reviews.error || writing.error || job?.error" role="alert">
      {{ reviews.error || writing.error || job?.error }}
    </p>
    <p v-if="reviews.needsRereview" class="review-warning" role="status">超过半数未处理问题已失锚，建议重新审查。</p>
    <div v-if="reviews.details?.result" class="issue-filters">
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
      <ReviewFeedback />
      <p v-if="job">{{ job.targetPath }} · {{ job.candidateId ? '候选稿' : '已保存正文' }}</p>
      <p v-if="reviews.details?.result">{{ reviews.details.result.summary }}</p>
      <p v-if="job?.excludedSources.length" class="review-warning">
        未发送待确认观察：{{ job.excludedSources.join('、') }}
      </p>
      <p v-if="reviews.details?.result && !reviews.visibleIssues.length">没有符合筛选条件的问题</p>
      <article
        v-for="value in reviews.visibleIssues"
        :key="value.index"
        :data-review-index="value.index"
        class="review-issue-row"
        :class="{ selected: reviews.selectedIssue === value.index }"
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
          <strong
            >{{ severityLabels[value.issue.severity] }} · {{ typeLabels[value.issue.type] ?? value.issue.type }}</strong
          ><span v-if="value.anchor.stale">原文已变化</span>
        </div>
        <AppButton variant="link" class="issue-quote" :disabled="value.anchor.stale" @click="locate(value.index)">
          {{ value.issue.quote }}
        </AppButton>
        <p>{{ value.issue.reason }}</p>
        <p>{{ value.issue.suggestion }}</p>
        <p v-if="value.issue.agentType === 'character'">{{ value.issue.expectedBehavior }}</p>
        <div class="issue-actions">
          <AppButton
            v-if="value.status === 'open'"
            size="xs"
            :disabled="value.anchor.stale"
            @click="writing.prepareRewrite(job!.id, [value.index])"
            >提出修订</AppButton
          >
          <AppButton size="xs" :disabled="value.anchor.stale" @click="locate(value.index)">定位</AppButton>
          <AppButton v-if="value.status !== 'resolved'" size="xs" @click="reviews.resolve([value.index], 'resolved')"
            >已处理</AppButton
          >
          <AppButton v-if="value.status !== 'ignored'" size="xs" @click="reviews.resolve([value.index], 'ignored')"
            >忽略</AppButton
          >
          <AppButton v-if="value.status !== 'open'" size="xs" @click="reviews.resolve([value.index], 'open')"
            >重新打开</AppButton
          >
        </div>
      </article>
    </div>
    <template v-if="job" #footer>
      <AppButton v-if="job.runId" size="xs" @click="runs.open(job.runId)">查看运行</AppButton>
      <AppButton
        size="xs"
        :disabled="!selectedIssues.length"
        @click="writing.prepareRewrite(job.id, [...selectedIssues])"
        >修订所选 ({{ selectedIssues.length }})</AppButton
      >
      <AppButton size="xs" @click="reviews.prepare(job.personaId)">重新审查正文</AppButton
      ><AppButton
        v-if="reviews.issueType !== 'all' && reviews.visibleIssues.length"
        size="xs"
        @click="
          reviews.resolve(
            reviews.visibleIssues.map(value => value.index),
            'ignored'
          )
        "
        >忽略此类问题</AppButton
      >
    </template>
  </AppPanel>
  <ReviewConfirmation />
</template>
<style scoped lang="scss">
.review-lanes {
  @apply flex flex-col gap-1 border-b p-3;
  border-color: var(--border-subtle);
}
.review-lane,
.review-running {
  @apply flex flex-wrap items-center gap-2;
}
.review-lane > span {
  @apply mr-auto;
}
.review-selection {
  @apply p-3;
}
.issue-filters {
  @apply grid gap-2 px-3 pb-3;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
}
p {
  @apply m-0 px-3 py-2;
  overflow-wrap: anywhere;
}
.review-issue-row {
  @apply border-b p-3;
  border-color: var(--border-subtle);
}
.review-issue-row.selected {
  background: var(--accent);
}
.review-issue-row p {
  @apply px-0 py-1;
}
.issue-heading {
  @apply flex flex-wrap justify-between gap-1;
}
.issue-heading strong {
  @apply font-medium;
}
.issue-quote {
  @apply my-2 w-full justify-start border-0 bg-transparent p-0 text-left;
  color: var(--foreground);
  overflow-wrap: anywhere;
}
.issue-quote:disabled {
  color: var(--muted-foreground);
}
.issue-actions {
  @apply flex shrink-0 flex-wrap gap-2 py-2;
}
.review-warning {
  color: var(--warning);
}
[role='alert'] {
  color: var(--destructive);
}
</style>
