<script setup lang="ts">
import { computed, onMounted } from 'vue';

import type { CandidateStatus } from '@chaptale/shared';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel } from '@/components/AppPanel';
import { AppTooltip } from '@/components/AppTooltip';
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
const icons: Record<CandidateStatus, string> = {
  preparing: 'i-mingcute-time-line',
  generating: 'i-mingcute-loading-3-line animate-spin',
  ready: 'i-mingcute-quill-pen-line candidate-attention',
  'partially-accepted': 'i-mingcute-quill-pen-line candidate-attention',
  accepted: 'i-mingcute-check-circle-line candidate-done',
  discarded: 'i-mingcute-forbid-circle-line',
  stale: 'i-mingcute-warning-line candidate-warning',
  failed: 'i-mingcute-close-circle-line candidate-failed',
  cancelled: 'i-mingcute-forbid-circle-line'
};
const pending = computed(
  () => writing.candidates.filter(item => ['ready', 'partially-accepted'].includes(item.status)).length
);
const subtitle = computed(() =>
  writing.candidates.length ? `${writing.candidates.length} 份 · ${pending.value} 待处理` : '当前作品还没有候选稿'
);
function timeLabel(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
onMounted(() => {
  void writing.refresh();
});
</script>
<template>
  <AppPanel class="candidate-panel" title="候选稿" title-hidden :subtitle="subtitle">
    <template #actions>
      <AppTooltip text="刷新候选" side="bottom" :side-offset="3">
        <AppButton icon size="xs" variant="ghost" aria-label="刷新候选" @click="writing.refresh">
          <span class="i-mingcute-refresh-3-line" />
        </AppButton>
      </AppTooltip>
    </template>

    <AppNotice v-if="writing.error" tone="error">{{ writing.error }}</AppNotice>
    <AppNotice v-for="message in writing.diagnostics" :key="message" tone="error">{{ message }}</AppNotice>
    <div v-for="id in writing.running" :key="id" class="candidate-running" role="status">
      <span class="i-mingcute-loading-3-line animate-spin size-4 shrink-0" aria-hidden="true" />
      <span class="candidate-running-label">正在生成 {{ id.slice(0, 8) }}</span>
      <AppButton size="xs" variant="ghost" @click="writing.cancel(id)">取消</AppButton>
    </div>
    <AppEmptyState
      v-if="!writing.candidates.length && !writing.running.length"
      icon="i-mingcute-quill-pen-line"
      title="还没有候选稿"
      description="先在「参考」里写下写作目标并组装来源，再生成候选；候选不会直接改动正文。"
    >
      <AppButton size="xs" :disabled="!editor.activeTab" @click="writing.prepare()">生成候选稿</AppButton>
    </AppEmptyState>
    <AppListItem
      v-for="candidate in writing.candidates"
      :key="candidate.id"
      class="candidate-item"
      :title="candidate.targetPath"
      :description="candidate.goal"
      :meta="`${labels[candidate.status]} · ${candidate.personaId} · ${timeLabel(candidate.createdAt)}`"
      :selected="writing.details?.candidate.id === candidate.id"
      @click="writing.read(candidate.id)"
    >
      <template #leading><span :class="icons[candidate.status]" class="size-4" aria-hidden="true" /></template>
    </AppListItem>

    <template #footer>
      <AppButton size="sm" variant="primary" :disabled="!editor.activeTab" @click="writing.prepare()">
        <span class="i-mingcute-add-line size-4" aria-hidden="true" />生成候选稿
      </AppButton>
    </template>
  </AppPanel>
</template>
<style scoped lang="scss">
.candidate-running {
  @apply flex items-center gap-2 px-3 py-1.5;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.candidate-running-label {
  @apply min-w-0 flex-1 truncate;
}
.candidate-attention {
  color: var(--primary-solid);
}
.candidate-done {
  color: var(--success);
}
.candidate-warning {
  color: var(--warning);
}
.candidate-failed {
  color: var(--destructive);
}
</style>
