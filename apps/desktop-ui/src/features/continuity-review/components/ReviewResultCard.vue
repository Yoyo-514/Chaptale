<script setup lang="ts">
import { computed, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppCollapsible } from '@/components/AppCollapsible';
import { AppScrollArea } from '@/components/AppScrollArea';

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

const headline = computed(() => {
  switch (props.state.status) {
    case 'running':
      return { icon: 'i-mingcute-loading-3-line animate-spin', text: '正在审查连贯性……' };
    case 'done':
      return props.state.issues.length > 0
        ? { icon: 'i-mingcute-eye-line', text: `发现 ${props.state.issues.length} 个连贯性问题` }
        : { icon: 'i-mingcute-check-circle-fill text-primary', text: '未发现连贯性问题' };
    case 'failed':
      return { icon: 'i-mingcute-warning-line', text: '审查未完成' };
    case 'cancelled':
      return { icon: 'i-mingcute-close-circle-line', text: '审查已取消' };
    default:
      return { icon: '', text: '' };
  }
});

// running/cancelled 没有可展开的内容，折叠行即全部信息。
const expandable = computed(() => props.state.status === 'done' || props.state.status === 'failed');

const open = ref(false);

// 结果就绪时自动展开，其余状态收起为一行。
watch(expandable, value => {
  open.value = value;
});
</script>

<template>
  <section v-if="visible" class="review-bar" aria-label="连贯性审查结果">
    <AppCollapsible v-model="open" class="review-collapsible" content-class="review-content" :disabled="!expandable">
      <template #trigger="{ open: isOpen }">
        <button type="button" class="review-trigger">
          <span :class="['size-4 shrink-0', headline.icon]" aria-hidden="true" />
          <span class="review-headline">{{ headline.text }}</span>
          <span
            v-if="expandable"
            :class="['size-4 shrink-0 review-chevron', isOpen ? 'i-mingcute-down-line' : 'i-mingcute-up-line']"
            aria-hidden="true"
          />
        </button>
      </template>

      <template v-if="state.status === 'done'">
        <p class="review-summary">{{ state.summary }}</p>
        <AppScrollArea v-if="state.issues.length > 0" class="review-scroll">
          <ul class="review-issue-list">
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
        </AppScrollArea>
      </template>

      <template v-else-if="state.status === 'failed'">
        <p class="review-status">结构化输出校验失败。</p>
        <ul class="review-error-list">
          <li v-for="(error, index) in state.errors" :key="index">{{ error }}</li>
        </ul>
        <p v-if="state.outputRef" class="review-output-ref">原始输出已保留：{{ state.outputRef }}</p>
      </template>
    </AppCollapsible>

    <!-- 动作独立于折叠触发行，避免 button 嵌套。 -->
    <div class="review-actions">
      <AppButton v-if="state.status === 'running'" variant="ghost" size="xs" type="button" @click="emit('cancel')">
        取消
      </AppButton>
      <AppButton v-else variant="ghost" size="xs" type="button" aria-label="关闭审查结果" @click="emit('dismiss')">
        <span class="i-mingcute-close-line size-4" aria-hidden="true" />
      </AppButton>
    </div>
  </section>
</template>

<style scoped lang="scss">
.review-bar {
  @apply relative text-sm;
}

.review-collapsible {
  // 内容向上展开，折叠行始终贴近输入框。
  @apply flex flex-col-reverse;
}

.review-trigger {
  // 右侧为绝对定位的动作按钮预留空间。
  @apply flex w-full items-center gap-2 border-0 bg-transparent py-1.5 pl-3 pr-14 text-left outline-none;

  color: var(--foreground);

  &:hover:not(:disabled) {
    background: var(--surface-muted);
  }
}

.review-headline {
  @apply min-w-0 flex-1 truncate font-medium;
}

.review-chevron {
  @apply text-xs;

  color: var(--muted-foreground);
}

.review-actions {
  @apply absolute bottom-1 right-2 flex items-center;
}

:deep(.review-content) {
  @apply px-3 py-2;

  border-bottom: 1px solid var(--border-subtle);
}

.review-summary {
  @apply text-foreground;
}

.review-status {
  @apply text-muted-foreground;
}

.review-scroll {
  @apply mt-2 max-h-32;
}

.review-issue-list {
  @apply space-y-3;
}

.review-issue-head {
  @apply flex items-center gap-2;
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
