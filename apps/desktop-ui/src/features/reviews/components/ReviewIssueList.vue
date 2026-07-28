<script setup lang="ts">
import type { ProjectedReviewIssue } from '../composables/useReviewLanes';

const props = defineProps<{
  issues: ProjectedReviewIssue[];
}>();

const severityMeta: Record<string, { label: string; className: string }> = {
  high: { label: '高', className: 'severity-high' },
  medium: { label: '中', className: 'severity-medium' },
  low: { label: '低', className: 'severity-low' }
};

function issueKey(issue: ProjectedReviewIssue, index: number) {
  return `${issue.type}-${issue.quote}-${index}`;
}

function styleSuggestion(issue: ProjectedReviewIssue) {
  return issue.agentType === 'style' ? issue.rewriteSuggestion : undefined;
}
</script>

<template>
  <ul class="review-issue-list">
    <li v-for="(issue, index) in props.issues" :key="issueKey(issue, index)" class="review-issue">
      <div class="review-issue-head">
        <span class="review-severity" :class="severityMeta[issue.severity]?.className">
          {{ severityMeta[issue.severity]?.label ?? issue.severity }}
        </span>
        <span class="review-issue-type">{{ issue.type }}</span>
        <span v-if="issue.anchor?.stale" class="review-anchor-stale">原文已变化</span>
      </div>
      <p class="review-issue-quote">{{ issue.quote }}</p>
      <p class="review-issue-detail">原因：{{ issue.reason }}</p>
      <p class="review-issue-detail">建议：{{ issue.suggestion }}</p>
      <p v-if="issue.agentType === 'character'" class="review-issue-detail">
        expectedBehavior：{{ issue.expectedBehavior }}
      </p>
      <p v-if="styleSuggestion(issue)" class="review-issue-detail">替换建议：{{ styleSuggestion(issue) }}</p>
    </li>
  </ul>
</template>

<style scoped lang="scss">
.review-issue-list {
  @apply m-0 list-none space-y-3 p-0;
}

.review-issue {
  @apply rounded-md border px-2.5 py-2;

  border-color: var(--border-subtle);
  background: var(--surface-muted);
}

.review-issue-head {
  @apply flex flex-wrap items-center gap-2;
}

.review-severity {
  @apply rounded px-1.5 py-0.5 text-xs font-medium;
}

.severity-high {
  @apply bg-red-500/15 text-red-600 dark:text-red-400;
}

.severity-medium {
  @apply bg-amber-500/15 text-amber-600 dark:text-amber-400;
}

.severity-low {
  @apply bg-slate-500/15 text-slate-600 dark:text-slate-400;
}

.review-issue-type,
.review-anchor-stale {
  @apply text-xs;

  color: var(--muted-foreground);
}

.review-anchor-stale {
  @apply rounded px-1.5 py-0.5;

  background: var(--surface-acrylic-strong);
}

.review-issue-quote {
  @apply mt-1 text-foreground;
}

.review-issue-detail {
  @apply mt-1 text-xs;

  color: var(--muted-foreground);
}
</style>
