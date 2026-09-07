<script setup lang="ts">
import { computed, nextTick, onMounted, ref, watch } from 'vue';

import { REVIEWERS } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { useWorkbenchStore } from '@/features/workbench';
import { useWritingStore } from '@/features/writing';

import { useReviewStore } from '../store';
const reviews = useReviewStore();
const writing = useWritingStore();
const navigation = useWorkbenchStore();
const list = ref<HTMLElement | null>(null);
const selectedIssues = ref<number[]>([]);
const labels = { running: '运行中', done: '已完成', failed: '失败', cancelled: '已取消' };
const severityLabels: Record<string, string> = { high: '高', medium: '中', low: '低' };
const job = computed(() => reviews.details?.job);
const typeLabels: Record<string, string> = {
  timeline: '时间线',
  world_rule: '设定规则',
  item_state: '物件状态',
  fact_conflict: '事实冲突',
  premature_reveal: '提前揭露',
  ooc: '人物行为',
  voice_mismatch: '人物语气',
  knowledge_leak: '知识越界',
  emotion_break: '情感断裂',
  weak_motivation: '动机不足',
  style_drift: '文风偏移',
  flat_rhythm: '节奏平淡',
  over_explaining: '过度解释',
  mechanical_emotion: '情绪直述',
  unnatural_dialogue: '对白生硬'
};
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
      <select
        :value="job?.id ?? ''"
        aria-label="审查记录"
        @change="event => reviews.read((event.target as HTMLSelectElement).value)"
      >
        <option value="" disabled>选择审查记录</option>
        <option v-for="item in reviews.jobs" :key="item.id" :value="item.id">
          {{ REVIEWERS.find(reviewer => reviewer.id === item.personaId)?.label }} · {{ item.targetPath }} ·
          {{ labels[item.status] }} · {{ item.id.slice(0, 8) }}
        </option>
      </select>
    </div>
    <p v-if="reviews.error || writing.error || job?.error" role="alert">
      {{ reviews.error || writing.error || job?.error }}
    </p>
    <p v-if="reviews.needsRereview" class="review-warning" role="status">超过半数未处理问题已失锚，建议重新审查。</p>
    <div v-if="reviews.details?.result" class="issue-filters">
      <select v-model="reviews.severity" aria-label="问题严重度">
        <option value="all">全部严重度</option>
        <option v-for="(label, key) in severityLabels" :key="key" :value="key">{{ label }}</option>
      </select>
      <select v-model="reviews.issueType" aria-label="问题类型">
        <option value="all">全部类型</option>
        <option v-for="kind in [...new Set(reviews.issues.map(value => value.issue.type))]" :key="kind" :value="kind">
          {{ typeLabels[kind] }}
        </option>
      </select>
      <select v-model="reviews.issueStatus" aria-label="问题处理状态">
        <option value="all">全部问题</option>
        <option value="open">未处理</option>
        <option value="resolved">已处理</option>
        <option value="ignored">已忽略</option>
      </select>
    </div>
    <AppScrollArea class="review-results">
      <div ref="list">
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
            <input
              v-model="selectedIssues"
              type="checkbox"
              :value="value.index"
              :aria-label="`选择问题 ${value.index + 1}`"
              :disabled="value.status !== 'open' || value.anchor.stale"
            />
            <strong>{{ severityLabels[value.issue.severity] }} · {{ typeLabels[value.issue.type] }}</strong
            ><span v-if="value.anchor.stale">原文已变化</span>
          </div>
          <button class="issue-quote" :disabled="value.anchor.stale" @click="locate(value.index)">
            {{ value.issue.quote }}
          </button>
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
        ><input v-model="reviews.enabled" type="checkbox" :value="reviewer.id" />{{ reviewer.label }}审查</label
      >
      <label
        >模型<select
          :value="
            reviews.models.findIndex(
              model =>
                model.provider === reviews.confirmation?.model.provider &&
                model.id === reviews.confirmation.model.modelId
            )
          "
          @change="
            event => {
              const model = reviews.models[Number((event.target as HTMLSelectElement).value)];
              if (model && reviews.confirmation)
                reviews.confirmation.model = { provider: model.provider, modelId: model.id };
            }
          "
        >
          <option v-for="(model, index) in reviews.models" :key="index" :value="index">
            {{ model.providerName }} / {{ model.name }}
          </option>
        </select></label
      >
      <label
        ><input v-model="reviews.confirmation.allowStalePack" type="checkbox" />允许使用来源已更新的旧参考快照</label
      >
      <footer>
        <AppButton size="sm" :disabled="!reviews.enabled.length" @click="reviews.start">启动审查</AppButton>
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.review-panel {
  @apply flex min-h-0 flex-1 flex-col text-xs;
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
select {
  @apply min-w-0 max-w-full rounded border px-1 py-1;
  background: var(--input-background);
  color: var(--foreground);
}
.review-selection select {
  @apply w-full;
}
.issue-filters {
  @apply grid shrink-0 grid-cols-3 gap-1 px-2 pb-2;
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
  @apply text-xs font-medium;
}
.issue-quote {
  @apply my-2 w-full border-0 bg-transparent p-0 text-left;
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
  color: #a46d0b;
}
[role='alert'] {
  color: var(--destructive);
}
.review-confirm {
  @apply flex min-h-0 flex-col gap-3 overflow-auto pt-3 text-xs;
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
