<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { REVIEWERS, REVIEW_ISSUE_LABELS } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppCheckbox } from '@/components/AppCheckbox';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useWorkbenchStore } from '@/features/workbench';
import { useWritingStore } from '@/features/writing';

import { useReviewStore } from '../store';
import ReviewFeedback from './ReviewFeedback.vue';
const reviews = useReviewStore();
const writing = useWritingStore();
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
  <section class="review-panel" aria-label="独立审查">
    <header>
      <span>独立审查</span><AppButton size="xs" @click="reviews.prepare()">运行审查</AppButton
      ><AppButton
        icon
        size="xs"
        variant="ghost"
        aria-label="打开审查中心"
        title="打开审查中心"
        @click="navigation.sidebar = 'review'"
        ><span class="i-mingcute-list-check-line size-3.5"
      /></AppButton>
    </header>
    <div class="review-lanes">
      <div v-for="reviewer in REVIEWERS" :key="reviewer.id" class="review-lane">
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
          {{ REVIEWERS.find(reviewer => reviewer.id === item.personaId)?.label }} · {{ item.targetPath }} ·
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
          {{ typeLabels[kind] }}
        </AppSelectItem>
      </AppSelect>
      <AppSelect v-model="reviews.issueStatus" aria-label="问题处理状态" content-size="sm">
        <AppSelectItem value="all">全部问题</AppSelectItem>
        <AppSelectItem value="open">未处理</AppSelectItem>
        <AppSelectItem value="resolved">已处理</AppSelectItem>
        <AppSelectItem value="ignored">已忽略</AppSelectItem>
      </AppSelect>
    </div>
    <AppScrollArea class="review-results">
      <div ref="list">
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
            <strong>{{ severityLabels[value.issue.severity] }} · {{ typeLabels[value.issue.type] }}</strong
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
    </AppScrollArea>
    <footer v-if="job">
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
    </footer>
  </section>
  <AppDialog
    :open="Boolean(reviews.confirmation)"
    title="启动独立审查"
    @update:open="open => !open && (reviews.confirmation = null)"
  >
    <div v-if="reviews.confirmation" class="review-confirm">
      <p>{{ reviews.confirmation.targetPath }} · {{ reviews.confirmation.candidateId ? '候选稿' : '已保存正文' }}</p>
      <p>本次写作参考：{{ reviews.confirmation.packId?.slice(0, 8) ?? '未选择' }}</p>
      <label v-for="reviewer in REVIEWERS" :key="reviewer.id"
        ><AppCheckbox
          :model-value="reviews.enabled.includes(reviewer.id)"
          @update:model-value="
            reviews.enabled =
              $event === true
                ? [...new Set([...reviews.enabled, reviewer.id])]
                : reviews.enabled.filter(id => id !== reviewer.id)
          "
        />{{ reviewer.label }}审查</label
      >
      <label
        >模型<AppSelect
          :model-value="
            String(
              reviews.models.findIndex(
                model =>
                  model.provider === reviews.confirmation?.model.provider &&
                  model.id === reviews.confirmation.model.modelId
              )
            )
          "
          @update:model-value="
            value => {
              const model = reviews.models[Number(value)];
              if (model && reviews.confirmation)
                reviews.confirmation.model = { provider: model.provider, modelId: model.id };
            }
          "
        >
          <AppSelectItem v-for="(model, index) in reviews.models" :key="index" :value="String(index)">
            {{ model.providerName }} / {{ model.name }}
          </AppSelectItem>
        </AppSelect></label
      >
      <label
        ><AppCheckbox
          :model-value="reviews.confirmation.allowStalePack"
          @update:model-value="reviews.confirmation.allowStalePack = $event === true"
        />允许使用来源已更新的旧参考快照</label
      >
      <footer>
        <AppButton size="sm" :disabled="!reviews.enabled.length" @click="reviews.start">启动审查</AppButton>
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.review-panel {
  @apply flex min-h-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex h-9 shrink-0 items-center gap-2 border-b px-3;
  border-color: var(--border-subtle);
}
header > span {
  @apply mr-auto;
}
.review-lanes {
  @apply flex shrink-0 flex-col gap-1 border-b p-2;
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
  @apply shrink-0 p-2;
}
.issue-filters {
  @apply grid shrink-0 gap-2 px-2 pb-2;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
}
.review-results {
  @apply min-h-0 flex-1;
}
.review-results p,
.review-panel > p {
  @apply px-3 py-2;
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
.issue-actions,
footer {
  @apply flex shrink-0 flex-wrap gap-2 py-2;
}
.review-panel > footer {
  @apply border-t px-2;
  border-color: var(--border-subtle);
}
.review-warning {
  color: var(--warning);
}
[role='alert'] {
  color: var(--destructive);
}
.review-confirm {
  @apply flex min-h-0 flex-col gap-4 overflow-auto pt-3;
  font-size: var(--ui-font-size);
}
.review-confirm label {
  @apply flex flex-wrap items-center gap-2;
}
.review-confirm p {
  overflow-wrap: anywhere;
}
.review-confirm footer {
  @apply justify-end;
}
</style>
