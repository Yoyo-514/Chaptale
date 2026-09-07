<script setup lang="ts">
import { onMounted } from 'vue';

import type { CandidateStatus } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
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
  <section class="candidate-panel" aria-label="候选稿">
    <header>
      <span>候选稿</span>
      <AppButton icon size="xs" variant="ghost" title="刷新候选" aria-label="刷新候选" @click="writing.refresh"
        ><span class="i-mingcute-refresh-3-line size-3.5"
      /></AppButton>
      <AppButton size="xs" :disabled="!editor.activeTab" @click="writing.prepare()">生成候选稿</AppButton>
    </header>
    <AppScrollArea class="candidate-list">
      <p v-if="writing.error" role="alert">{{ writing.error }}</p>
      <p v-for="message in writing.diagnostics" :key="message" role="alert">{{ message }}</p>
      <div v-for="id in writing.running" :key="id" class="candidate-row">
        <span role="status">正在生成 {{ id.slice(0, 8) }}</span>
        <AppButton size="xs" @click="writing.cancel(id)">取消</AppButton>
      </div>
      <p v-if="!writing.candidates.length && !writing.running.length">暂无候选稿</p>
      <button
        v-for="candidate in writing.candidates"
        :key="candidate.id"
        class="candidate-item"
        @click="writing.read(candidate.id)"
      >
        <strong>{{ candidate.targetPath }}</strong>
        <span>{{ labels[candidate.status] }} · {{ candidate.personaId }}</span>
        <span>{{ candidate.goal }}</span>
        <small>{{ new Date(candidate.createdAt).toLocaleString() }}</small>
      </button>
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.candidate-panel {
  @apply flex min-h-0 flex-1 flex-col text-xs;
}
header {
  @apply flex h-9 shrink-0 items-center gap-2 border-b px-3;
  border-color: var(--border-subtle);
}
header > span {
  @apply mr-auto;
}
.candidate-list {
  @apply min-h-0 flex-1;
}
.candidate-list p {
  @apply p-3;
  overflow-wrap: anywhere;
}
[role='alert'] {
  color: var(--destructive);
}
.candidate-row {
  @apply flex items-center justify-between gap-2 p-3;
}
.candidate-item {
  @apply flex w-full flex-col gap-1 border-0 border-b bg-transparent p-3 text-left;
  color: var(--foreground);
  border-color: var(--border-subtle);
  overflow-wrap: anywhere;
}
.candidate-item:hover {
  background: var(--accent);
}
.candidate-item strong {
  @apply text-xs font-medium;
}
.candidate-item span,
.candidate-item small {
  color: var(--muted-foreground);
}
</style>
