<script setup lang="ts">
import { computed } from 'vue';

import { useEditorStore } from '@/features/editor';
import { useLibraryStore } from '@/features/library';
import { useReviewStore } from '@/features/reviews';
import { useSettlementStore } from '@/features/settlement';
import { useWorkbenchStore } from '@/features/workbench';
import { useWritingStore } from '@/features/writing';

type FlowView = 'references' | 'candidates' | 'review' | 'settlement';
type Tone = 'idle' | 'active' | 'busy' | 'attention';
interface FlowStep {
  view: FlowView;
  label: string;
  icon: string;
  status: string;
  tone: Tone;
}

const editor = useEditorStore();
const library = useLibraryStore();
const writing = useWritingStore();
const reviews = useReviewStore();
const settlement = useSettlementStore();
const navigation = useWorkbenchStore();

const chapter = computed(() => editor.activeTab?.path);

const steps = computed<FlowStep[]>(() => {
  const path = chapter.value;
  const pendingCandidates = writing.candidates.filter(
    item => item.targetPath === path && ['ready', 'partially-accepted'].includes(item.status)
  ).length;
  const openIssues =
    reviews.details?.job.targetPath === path ? reviews.issues.filter(item => item.status === 'open').length : 0;
  const reviewJobs = reviews.jobs.filter(job => job.targetPath === path).length;
  const pendingFacts = settlement.batches
    .filter(batch => batch.chapterPath === path && !['completed', 'cancelled'].includes(batch.status))
    .reduce((sum, batch) => sum + batch.pending, 0);
  const settled = settlement.batches.some(batch => batch.chapterPath === path && batch.status === 'completed');
  return [
    {
      view: 'references',
      label: '参考',
      icon: library.frozen || library.selections.length ? 'i-mingcute-bookmark-fill' : 'i-mingcute-bookmark-line',
      ...(library.frozen
        ? { status: `${library.selections.length} 项 · 已冻结`, tone: 'active' as Tone }
        : library.selections.length
          ? { status: `${library.selections.length} 项`, tone: 'active' as Tone }
          : { status: '未组装', tone: 'idle' as Tone })
    },
    {
      view: 'candidates',
      label: '候选',
      icon: pendingCandidates ? 'i-mingcute-quill-pen-fill' : 'i-mingcute-quill-pen-line',
      ...(writing.running.length
        ? { status: '生成中', tone: 'busy' as Tone }
        : pendingCandidates
          ? { status: `${pendingCandidates} 待处理`, tone: 'attention' as Tone }
          : { status: '暂无', tone: 'idle' as Tone })
    },
    {
      view: 'review',
      label: '审查',
      icon: reviewJobs && !openIssues ? 'i-mingcute-check-circle-fill' : 'i-mingcute-check-circle-line',
      ...(reviews.running.length
        ? { status: '审查中', tone: 'busy' as Tone }
        : openIssues
          ? { status: `${openIssues} 个问题`, tone: 'attention' as Tone }
          : reviewJobs
            ? { status: `${reviewJobs} 次记录`, tone: 'active' as Tone }
            : { status: '未审查', tone: 'idle' as Tone })
    },
    {
      view: 'settlement',
      label: '结算',
      icon: settled && !pendingFacts ? 'i-mingcute-inbox-2-fill' : 'i-mingcute-inbox-2-line',
      ...(settlement.running.length
        ? { status: '结算中', tone: 'busy' as Tone }
        : pendingFacts
          ? { status: `${pendingFacts} 项待确认`, tone: 'attention' as Tone }
          : settled
            ? { status: '已结算', tone: 'active' as Tone }
            : { status: '未结算', tone: 'idle' as Tone })
    }
  ];
});
</script>

<template>
  <nav class="writing-flow" aria-label="写作流程">
    <ol class="writing-flow-steps">
      <li v-for="(step, index) in steps" :key="step.view" class="writing-flow-item">
        <span v-if="index > 0" class="i-mingcute-right-line writing-flow-arrow" aria-hidden="true" />
        <button
          type="button"
          class="writing-flow-step"
          :class="`is-${step.tone}`"
          :aria-current="navigation.auxiliary === step.view ? 'step' : undefined"
          :title="chapter ? `${step.label}：${step.status}` : `${step.label}：请先打开正文`"
          @click="navigation.showAuxiliary(step.view)"
        >
          <span :class="step.icon" class="writing-flow-icon" aria-hidden="true" />
          <span class="writing-flow-copy">
            <span class="writing-flow-label">{{ step.label }}</span>
            <span class="writing-flow-status">{{ step.status }}</span>
          </span>
        </button>
      </li>
    </ol>
  </nav>
</template>

<style scoped lang="scss">
.writing-flow {
  @apply shrink-0 border-b px-2 pb-2 pt-1;
  border-color: var(--border-subtle);
}
.writing-flow-steps {
  @apply m-0 flex list-none items-stretch p-0;
}
.writing-flow-item {
  @apply flex min-w-0 flex-1 items-center;
}
// 段间的箭头是流程本身：读作「参考 → 候选 → 审查 → 结算」，而不是四个并列标签。
.writing-flow-arrow {
  @apply size-3 shrink-0;
  color: var(--border-strong);
}
.writing-flow-step {
  @apply flex h-10 w-full min-w-0 items-center gap-1 border-0 bg-transparent px-1 text-left outline-none;
  border-radius: var(--radius-control-sm);
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  transition:
    background-color var(--motion-duration) ease-out,
    color var(--motion-duration) ease-out;
}
.writing-flow-step:hover {
  background: var(--surface-hover);
  color: var(--foreground);
}
.writing-flow-step:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.writing-flow-step[aria-current='step'] {
  background: var(--accent);
  color: var(--accent-foreground);
}
.writing-flow-icon {
  @apply size-4 shrink-0;
}
.writing-flow-step.is-active .writing-flow-icon,
.writing-flow-step.is-busy .writing-flow-icon {
  color: var(--primary-solid);
}
.writing-flow-step.is-attention .writing-flow-icon {
  color: var(--warning);
}
.writing-flow-step[aria-current='step'] .writing-flow-icon {
  color: inherit;
}
.writing-flow-copy {
  @apply flex min-w-0 flex-col leading-tight;
}
.writing-flow-label {
  @apply truncate font-medium;
  color: var(--foreground);
}
.writing-flow-step[aria-current='step'] .writing-flow-label {
  color: inherit;
}
.writing-flow-status {
  @apply truncate;
  font-variant-numeric: tabular-nums;
}
.writing-flow-step.is-attention .writing-flow-status {
  color: var(--warning);
}
.writing-flow-step[aria-current='step'] .writing-flow-status {
  color: inherit;
}

// 窄面板只留图标与状态，标签交给 title。
@container side-panel (max-width: 300px) {
  .writing-flow-label {
    @apply sr-only;
  }
  .writing-flow-step {
    @apply h-8 justify-center px-1;
  }
}
</style>
