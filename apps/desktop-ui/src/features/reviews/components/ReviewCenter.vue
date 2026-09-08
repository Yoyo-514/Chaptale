<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useWorkbenchStore } from '@/features/workbench';

import { useReviewStore } from '../store';
const reviews = useReviewStore();
const navigation = useWorkbenchStore();
const chapter = ref('__all');
const reviewer = ref('__all');
const status = ref('__all');
const jobs = computed(() =>
  reviews.jobs.filter(
    job =>
      (chapter.value === '__all' || job.targetPath === chapter.value) &&
      (reviewer.value === '__all' || job.personaId === reviewer.value) &&
      (status.value === '__all' || job.status === status.value)
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
      <AppTooltip text="隐藏侧栏"
        ><AppButton icon size="xs" variant="ghost" aria-label="隐藏侧栏" @click="navigation.sidebarOpen = false"
          ><span class="i-mingcute-close-line size-4" aria-hidden="true" /></AppButton
      ></AppTooltip>
    </header>
    <div class="review-filters">
      <AppSelect v-model="chapter" aria-label="审查章节">
        <AppSelectItem value="__all">全部章节</AppSelectItem>
        <AppSelectItem v-for="path in [...new Set(reviews.jobs.map(job => job.targetPath))]" :key="path" :value="path">
          {{ path }}
        </AppSelectItem>
      </AppSelect>
      <AppSelect v-model="reviewer" aria-label="审查角色">
        <AppSelectItem value="__all">全部审查</AppSelectItem>
        <AppSelectItem v-for="item in reviews.reviewerOptions" :key="item.id" :value="item.id">{{
          item.label
        }}</AppSelectItem>
      </AppSelect>
      <AppSelect v-model="status" aria-label="审查运行状态">
        <AppSelectItem value="__all">全部运行状态</AppSelectItem>
        <AppSelectItem v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</AppSelectItem>
      </AppSelect>
    </div>
    <AppScrollArea class="review-history">
      <p v-for="message in reviews.diagnostics" :key="message" role="alert">{{ message }}</p>
      <p v-if="!jobs.length">暂无审查记录</p>
      <AppButton v-for="job in jobs" :key="job.id" variant="ghost" class="review-job" @click="reviews.read(job.id)">
        <strong>{{ job.targetPath }}</strong
        ><span
          >{{ reviews.reviewerLabel(job.personaId, job.personaName) }} · {{ labels[job.status] }} ·
          {{ job.candidateId ? '候选稿' : '已保存正文' }}</span
        >
        <small>{{ new Date(job.createdAt).toLocaleString() }} · {{ job.id.slice(0, 8) }}</small>
      </AppButton>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.review-center {
  @apply flex min-h-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex h-9 shrink-0 items-center justify-between px-3;
}
.review-filters {
  @apply flex shrink-0 flex-col gap-2 border-b p-3;
  border-color: var(--border-subtle);
}
.review-history {
  @apply min-h-0 flex-1;
}
.review-history p {
  @apply p-3;
  overflow-wrap: anywhere;
}
.review-job {
  @apply flex w-full flex-col items-start gap-1 rounded-none border-0 border-b bg-transparent p-3 text-left;
  border-color: var(--border-subtle);
  color: var(--foreground);
  overflow-wrap: anywhere;
}
.review-job:hover {
  background: var(--accent);
}
.review-job strong {
  @apply font-medium;
}
.review-job span,
small {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
[role='alert'] {
  color: var(--destructive);
}
</style>
