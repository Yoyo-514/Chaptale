<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel, AppPanelSection } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

import { useReviewStore } from '../store';
const reviews = useReviewStore();
const chapter = ref('__all');
const reviewer = ref('__all');
const status = ref('__all');
const labels = { running: '运行中', done: '已完成', failed: '失败', cancelled: '已取消' };
const icons = {
  running: 'i-mingcute-loading-3-line animate-spin',
  done: 'i-mingcute-check-circle-line',
  failed: 'i-mingcute-close-circle-line',
  cancelled: 'i-mingcute-forbid-circle-line'
};
const jobs = computed(() =>
  reviews.jobs.filter(
    job =>
      (chapter.value === '__all' || job.targetPath === chapter.value) &&
      (reviewer.value === '__all' || job.personaId === reviewer.value) &&
      (status.value === '__all' || job.status === status.value)
  )
);
const chapters = computed(() => [...new Set(reviews.jobs.map(job => job.targetPath))]);
/** 按章节分组：同一章的多次审查放在一起，最新的在前。 */
const groups = computed(() =>
  chapters.value
    .map(path => ({
      path,
      jobs: jobs.value.filter(job => job.targetPath === path).toSorted((a, b) => b.createdAt.localeCompare(a.createdAt))
    }))
    .filter(group => group.jobs.length)
);
const filtered = computed(() => chapter.value !== '__all' || reviewer.value !== '__all' || status.value !== '__all');
function timeLabel(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
function clearFilters() {
  chapter.value = '__all';
  reviewer.value = '__all';
  status.value = '__all';
}
onMounted(() => {
  void reviews.refresh();
});
</script>
<template>
  <AppPanel class="review-center" title="审查中心" :count="jobs.length">
    <template #toolbar>
      <AppSelect v-model="chapter" aria-label="审查章节" class="app-panel-toolbar-full">
        <AppSelectItem value="__all">全部章节</AppSelectItem>
        <AppSelectItem v-for="path in chapters" :key="path" :value="path">{{ path }}</AppSelectItem>
      </AppSelect>
      <AppSelect v-model="reviewer" aria-label="审查角色" class="review-center-narrow">
        <AppSelectItem value="__all">全部审查</AppSelectItem>
        <AppSelectItem v-for="item in reviews.reviewerOptions" :key="item.id" :value="item.id">{{
          item.label
        }}</AppSelectItem>
      </AppSelect>
      <AppSelect v-model="status" aria-label="审查运行状态" class="review-center-narrow">
        <AppSelectItem value="__all">全部运行状态</AppSelectItem>
        <AppSelectItem v-for="(label, key) in labels" :key="key" :value="key">{{ label }}</AppSelectItem>
      </AppSelect>
    </template>

    <AppNotice v-for="message in reviews.diagnostics" :key="message" tone="error">{{ message }}</AppNotice>
    <AppEmptyState
      v-if="!jobs.length"
      icon="i-mingcute-check-circle-line"
      :title="filtered ? '没有符合筛选的审查' : '还没有审查记录'"
      :description="filtered ? '放宽章节、角色或状态筛选。' : '在辅助栏「审查」里运行一次独立审查，记录会出现在这里。'"
    >
      <AppButton v-if="filtered" size="xs" @click="clearFilters">清除筛选</AppButton>
    </AppEmptyState>
    <AppPanelSection v-for="group in groups" :key="group.path" :title="group.path" :count="group.jobs.length">
      <AppListItem
        v-for="job in group.jobs"
        :key="job.id"
        class="review-job"
        :title="job.targetPath"
        :description="`${reviews.reviewerLabel(job.personaId, job.personaName)} · ${labels[job.status]} · ${job.candidateId ? '候选稿' : '已保存正文'}`"
        :meta="`${timeLabel(job.createdAt)} · ${job.id.slice(0, 8)}`"
        :selected="reviews.details?.job.id === job.id"
        @click="reviews.read(job.id)"
      >
        <template #leading>
          <span
            :class="[icons[job.status], { 'review-job-failed': job.status === 'failed' }]"
            class="size-4"
            aria-hidden="true"
          />
        </template>
      </AppListItem>
    </AppPanelSection>
  </AppPanel>
</template>
<style scoped lang="scss">
// 角色与状态两个下拉并排占一行；侧栏窄到放不下两个 7.5rem 的触发器时各自独占一行，不截断选项文字。
.review-center :deep(.app-panel-toolbar) {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 7.5rem), 1fr));
}
// 分节头已写明章节，行内标题只留给读屏与测试定位，视觉上以审查角色开头。
.review-job :deep(.app-list-item-title) {
  @apply sr-only;
}
.review-job :deep(.app-list-item-description) {
  color: var(--foreground);
  font-size: var(--ui-font-size);
}
.review-job-failed {
  color: var(--destructive);
}
</style>
