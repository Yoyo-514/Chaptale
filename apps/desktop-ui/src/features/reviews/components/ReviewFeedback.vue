<script setup lang="ts">
import { computed, onMounted, watch } from 'vue';

import { REVIEWERS, REVIEW_ISSUE_LABELS } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppTextarea } from '@/components/AppTextarea';

import { useReviewFeedbackStore } from '../feedback-store';
import { useReviewStore } from '../store';

const reviews = useReviewStore();
const feedback = useReviewFeedbackStore();
const suggestions = computed(() =>
  feedback.data.suggestions.filter(item => !reviews.details || item.personaId === reviews.details.job.personaId)
);
const label = (id: string) => REVIEWERS.find(item => item.id === id)?.label ?? id;
onMounted(() => void feedback.refresh());
watch(
  () => reviews.details,
  () => void feedback.refresh()
);
</script>
<template>
  <section
    v-if="suggestions.length || feedback.data.preferences.length || feedback.error || feedback.data.diagnostics.length"
    class="review-feedback"
    aria-label="审查偏好"
  >
    <p v-if="feedback.error" role="alert">{{ feedback.error }}</p>
    <p v-for="diagnostic in feedback.data.diagnostics" :key="diagnostic" role="alert">{{ diagnostic }}</p>
    <div v-for="item in suggestions" :key="item.id" class="feedback-suggestion">
      <h3>{{ label(item.personaId) }} · {{ REVIEW_ISSUE_LABELS[item.issueType] }}</h3>
      <p>已连续忽略 {{ item.ignoredCount }} 条不同问题</p>
      <div class="feedback-actions">
        <AppButton size="sm" :disabled="feedback.busy" @click="feedback.prepare(item)">调整检查</AppButton>
        <AppButton size="sm" variant="ghost" :disabled="feedback.busy" @click="feedback.resolve(item.id, 'dismiss')"
          >不再提示</AppButton
        >
      </div>
    </div>
    <details v-if="feedback.data.preferences.length">
      <summary>已确认偏好 ({{ feedback.data.preferences.length }})</summary>
      <div v-for="item in feedback.data.preferences" :key="item.id" class="feedback-preference">
        <strong>{{ label(item.personaId) }} · {{ REVIEW_ISSUE_LABELS[item.issueType] }}</strong>
        <p>{{ item.text }}</p>
      </div>
    </details>
  </section>
  <AppDialog
    :open="Boolean(feedback.confirmation)"
    title="确认审查偏好"
    @update:open="open => !open && !feedback.busy && (feedback.confirmation = null)"
  >
    <div v-if="feedback.confirmation" class="feedback-dialog">
      <p>
        {{ label(feedback.confirmation.personaId) }} · {{ REVIEW_ISSUE_LABELS[feedback.confirmation.issueType] }} ·
        跨作品生效
      </p>
      <AppTextarea v-model="feedback.text" aria-label="审查偏好内容" :rows="5" :maxlength="4000" />
      <p v-if="feedback.error" role="alert">{{ feedback.error }}</p>
      <footer>
        <AppButton :disabled="feedback.busy" @click="feedback.confirmation = null">取消</AppButton>
        <AppButton
          variant="primary"
          :disabled="feedback.busy || !feedback.text.trim()"
          @click="feedback.resolve(feedback.confirmation.id, 'accept')"
          >确认偏好</AppButton
        >
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.review-feedback {
  @apply border-b p-3;
  border-color: var(--border-subtle);
  font-size: var(--ui-font-size);
}
.feedback-suggestion,
.feedback-preference,
.feedback-dialog {
  @apply flex min-w-0 flex-col gap-2 py-2;
}
h3,
p {
  @apply m-0;
  font-size: inherit;
  overflow-wrap: anywhere;
}
h3,
strong {
  @apply font-medium;
}
.feedback-actions,
footer {
  @apply flex flex-wrap gap-2;
}
footer {
  @apply justify-end;
}
summary {
  @apply cursor-pointer py-2;
  color: var(--muted-foreground);
}
.feedback-dialog {
  @apply pt-3;
  font-size: var(--ui-font-size);
}
[role='alert'] {
  color: var(--destructive);
}
</style>
