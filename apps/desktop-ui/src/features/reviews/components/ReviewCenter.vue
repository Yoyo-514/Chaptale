<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppListItem } from '@/components/AppListItem';
import { AppPanel } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

import { useReviewStore } from '../store';
const reviews = useReviewStore();
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
  <AppPanel class="review-center" title="审查中心" :count="jobs.length">
    <template #actions>
      <AppButton icon size="xs" variant="ghost" title="刷新审查" aria-label="刷新审查" @click="reviews.refresh"
        ><span class="i-mingcute-refresh-3-line size-3.5"
      /></AppButton>
    </template>
    <template #toolbar>
      <div class="review-filters">
        <AppSelect v-model="chapter" aria-label="审查章节">
          <AppSelectItem value="__all">全部章节</AppSelectItem>
          <AppSelectItem
            v-for="path in [...new Set(reviews.jobs.map(job => job.targetPath))]"
            :key="path"
            :value="path"
          >
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
    </template>
    <div class="review-history">
      <p v-for="message in reviews.diagnostics" :key="message" role="alert">{{ message }}</p>
      <p v-if="!jobs.length">暂无审查记录</p>
      <AppListItem
        v-for="job in jobs"
        :key="job.id"
        class="review-job"
        :title="job.targetPath"
        :description="`${reviews.reviewerLabel(job.personaId, job.personaName)} · ${labels[job.status]} · ${job.candidateId ? '候选稿' : '已保存正文'}`"
        :meta="`${new Date(job.createdAt).toLocaleString()} · ${job.id.slice(0, 8)}`"
        :selected="reviews.details?.job.id === job.id"
        @click="reviews.read(job.id)"
      />
    </div>
  </AppPanel>
</template>
<style scoped lang="scss">
.review-filters {
  @apply grid gap-2 p-3;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 8rem), 1fr));
}
.review-history p {
  @apply m-0 p-4;
  overflow-wrap: anywhere;
  color: var(--muted-foreground);
}
.review-history [role='alert'] {
  color: var(--destructive);
}
</style>
