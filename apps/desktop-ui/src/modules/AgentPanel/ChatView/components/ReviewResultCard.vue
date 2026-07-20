<script setup lang="ts">
import { computed } from 'vue';

import { AppButton } from '@/components/AppButton';

import type { ContinuityReviewState } from '../composables/useContinuityReview';

const props = defineProps<{
  state: ContinuityReviewState;
}>();

const emit = defineEmits<{
  cancel: [];
  dismiss: [];
}>();

const severityMeta: Record<string, { label: string; className: string }> = {
  high: { label: '高', className: 'severity-high' },
  medium: { label: '中', className: 'severity-medium' },
  low: { label: '低', className: 'severity-low' }
};

const visible = computed(() => props.state.status !== 'idle');
</script>

<template>
  <section v-if="visible" class="review-card" aria-label="连贯性审查结果">
    <header class="review-card-header">
      <span class="review-card-title">
        <span class="i-mingcute-search-eye-line size-4" aria-hidden="true" />
        连贯性审查
      </span>
      <div class="review-card-actions">
        <AppButton v-if="state.status === 'running'" variant="ghost" size="xs" type="button" @click="emit('cancel')">
          取消
        </AppButton>
        <AppButton
          v-if="state.status !== 'running'"
          variant="ghost"
          size="xs"
          type="button"
          aria-label="关闭审查结果"
          @click="emit('dismiss')"
        >
          <span class="i-mingcute-close-line size-4" aria-hidden="true" />
        </AppButton>
      </div>
    </header>

    <p v-if="state.status === 'running'" class="review-card-status">正在审查，通常需要十几秒……</p>
    <p v-else-if="state.status === 'cancelled'" class="review-card-status">已取消。</p>

    <template v-else-if="state.status === 'done'">
      <p class="review-card-summary">{{ state.summary }}</p>
      <ul v-if="state.issues.length > 0" class="review-issue-list">
        <li v-for="issue in state.issues" :key="issue.id" class="review-issue">
          <div class="review-issue-head">
            <span class="review-severity" :class="severityMeta[issue.severity]?.className">
              {{ severityMeta[issue.severity]?.label ?? issue.severity }}
            </span>
            <span class="review-issue-location">{{ issue.location }}</span>
          </div>
          <p class="review-issue-description">{{ issue.description }}</p>
          <p v-if="issue.suggestion" class="review-issue-suggestion">建议：{{ issue.suggestion }}</p>
        </li>
      </ul>
      <p v-else class="review-card-status">未发现连贯性问题。</p>
    </template>

    <template v-else>
      <p class="review-card-status">审查未完成，结构化输出校验失败。</p>
      <ul class="review-error-list">
        <li v-for="(error, index) in state.errors" :key="index">{{ error }}</li>
      </ul>
      <p v-if="state.outputRef" class="review-output-ref">原始输出已保留：{{ state.outputRef }}</p>
    </template>
  </section>
</template>

<style scoped lang="scss">
.review-card {
  @apply mx-4 mb-2 rounded-lg border border-border bg-card px-4 py-3 text-sm shadow-sm;
}

.review-card-header {
  @apply flex items-center justify-between;
}

.review-card-title {
  @apply flex items-center gap-1.5 font-medium text-foreground;
}

.review-card-actions {
  @apply flex items-center gap-1;
}

.review-card-status {
  @apply mt-2 text-muted-foreground;
}

.review-card-summary {
  @apply mt-2 text-foreground;
}

.review-issue-list {
  @apply mt-3 space-y-3;
}

.review-issue {
  @apply rounded-md border border-border/60 bg-muted/40 px-3 py-2;
}

.review-issue-head {
  @apply flex items-center gap-2;
}

.review-severity {
  @apply inline-flex items-center rounded px-1.5 py-0.5 text-xs font-medium;
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

.review-issue-location {
  @apply text-xs text-muted-foreground;
}

.review-issue-description {
  @apply mt-1 text-foreground;
}

.review-issue-suggestion {
  @apply mt-1 text-xs text-muted-foreground;
}

.review-error-list {
  @apply mt-2 list-disc space-y-1 pl-5 text-xs text-muted-foreground;
}

.review-output-ref {
  @apply mt-2 text-xs text-muted-foreground;
  word-break: break-all;
}
</style>
