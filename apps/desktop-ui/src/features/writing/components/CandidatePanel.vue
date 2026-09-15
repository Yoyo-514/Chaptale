<script setup lang="ts">
import { onMounted } from 'vue';

import type { CandidateStatus } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppListItem } from '@/components/AppListItem';
import { AppPanel } from '@/components/AppPanel';
import { useEditorStore } from '@/features/editor';

import { useWritingStore } from '../store';

const writing = useWritingStore();
const editor = useEditorStore();
const labels: Record<CandidateStatus, string> = {
  preparing: '准备中',
  generating: '生成中',
  ready: '待处理',
  'partially-accepted': '部分接受',
  accepted: '已接受',
  discarded: '已放弃',
  stale: '正文已变化',
  failed: '失败',
  cancelled: '已取消'
};
onMounted(() => {
  void writing.refresh();
});
</script>
<template>
  <AppPanel class="candidate-panel" title="候选稿" :count="writing.candidates.length">
    <template #actions>
      <AppButton icon size="xs" variant="ghost" title="刷新候选" aria-label="刷新候选" @click="writing.refresh"
        ><span class="i-mingcute-refresh-3-line size-3.5"
      /></AppButton>
    </template>
    <div class="candidate-list">
      <p v-if="writing.error" role="alert">{{ writing.error }}</p>
      <p v-for="message in writing.diagnostics" :key="message" role="alert">{{ message }}</p>
      <div v-for="id in writing.running" :key="id" class="candidate-row">
        <span role="status">正在生成 {{ id.slice(0, 8) }}</span>
        <AppButton size="xs" @click="writing.cancel(id)">取消</AppButton>
      </div>
      <p v-if="!writing.candidates.length && !writing.running.length">暂无候选稿</p>
      <AppListItem
        v-for="candidate in writing.candidates"
        :key="candidate.id"
        class="candidate-item"
        :title="candidate.targetPath"
        :description="candidate.goal"
        :meta="`${labels[candidate.status]} · ${candidate.personaId} · ${new Date(candidate.createdAt).toLocaleString()}`"
        @click="writing.read(candidate.id)"
      />
    </div>
    <template #footer>
      <AppButton :disabled="!editor.activeTab" @click="writing.prepare()">
        <span class="i-mingcute-add-line size-4" aria-hidden="true" />生成候选稿
      </AppButton>
    </template>
  </AppPanel>
</template>
<style scoped lang="scss">
.candidate-list p {
  @apply m-0 p-4;
  color: var(--muted-foreground);
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
.candidate-row {
  @apply flex items-center justify-between gap-2 p-3;
}
</style>
