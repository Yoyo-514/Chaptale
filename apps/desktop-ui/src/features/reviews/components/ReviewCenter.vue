<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { REVIEWERS } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';

import { useReviewStore } from '../store';
const reviews = useReviewStore();
const chapter = ref('');
const reviewer = ref('');
const status = ref('');
const jobs = computed(() =>
  reviews.jobs.filter(
    job =>
      (!chapter.value || job.targetPath === chapter.value) &&
      (!reviewer.value || job.personaId === reviewer.value) &&
      (!status.value || job.status === status.value)
  )
);
const labels = { running: '运行中', done: '已完成', failed: '失败', cancelled: '已取消' };
onMounted(() => {
  void reviews.refresh();
});
</script>
<template>
  <section class="review-center" aria-label="审查中心">
    <header>
      <span>审查中心</span
      ><AppButton icon size="xs" variant="ghost" title="刷新审查" aria-label="刷新审查" @click="reviews.refresh"
        ><span class="i-mingcute-refresh-3-line size-3.5"
      /></AppButton>
    </header>
    <div class="review-filters">
      <select v-model="chapter" aria-label="审查章节">
        <option value="">全部章节</option>
        <option v-for="path in [...new Set(reviews.jobs.map(job => job.targetPath))]" :key="path" :value="path">
          {{ path }}
        </option>
      </select>
      <select v-model="reviewer" aria-label="审查角色">
        <option value="">全部审查</option>
        <option v-for="item in REVIEWERS" :key="item.id" :value="item.id">{{ item.label }}</option>
      </select>
      <select v-model="status" aria-label="审查运行状态">
        <option value="">全部运行状态</option>
        <option v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</option>
      </select>
    </div>
    <AppScrollArea class="review-history">
      <p v-for="message in reviews.diagnostics" :key="message" role="alert">{{ message }}</p>
      <p v-if="!jobs.length">暂无审查记录</p>
      <button v-for="job in jobs" :key="job.id" class="review-job" @click="reviews.read(job.id)">
        <strong>{{ job.targetPath }}</strong
        ><span
          >{{ REVIEWERS.find(item => item.id === job.personaId)?.label }} · {{ labels[job.status] }} ·
          {{ job.candidateId ? '候选稿' : '已保存正文' }}</span
        >
        <small>{{ new Date(job.createdAt).toLocaleString() }} · {{ job.id.slice(0, 8) }}</small>
      </button>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.review-center {
  @apply flex min-h-0 flex-1 flex-col text-xs;
}
header {
  @apply flex h-9 shrink-0 items-center justify-between px-3;
}
.review-filters {
  @apply flex shrink-0 flex-col gap-2 border-b p-3;
  border-color: var(--border-subtle);
}
select {
  @apply min-w-0 max-w-full rounded border p-1;
  color: var(--foreground);
  background: var(--input-background);
}
.review-history {
  @apply min-h-0 flex-1;
}
.review-history p {
  @apply p-3;
  overflow-wrap: anywhere;
}
.review-job {
  @apply flex w-full flex-col gap-1 border-0 border-b bg-transparent p-3 text-left;
  border-color: var(--border-subtle);
  color: var(--foreground);
  overflow-wrap: anywhere;
}
.review-job:hover {
  background: var(--accent);
}
.review-job strong {
  @apply text-xs font-medium;
}
.review-job span,
small {
  color: var(--muted-foreground);
}
[role='alert'] {
  color: var(--destructive);
}
</style>
