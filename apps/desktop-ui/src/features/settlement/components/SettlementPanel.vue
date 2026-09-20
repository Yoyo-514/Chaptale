<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useWorkspaceStore } from '@/features/workspace';

import { useSettlementStore } from '../store';

const settlement = useSettlementStore();
const workspace = useWorkspaceStore();
const editor = useEditorStore();
const filter = ref('pending');
const labels = { generating: '结算中', ready: '待确认事实', completed: '已结算', failed: '失败', cancelled: '已取消' };
const icons = {
  generating: 'i-mingcute-loading-3-line animate-spin',
  ready: 'i-mingcute-inbox-2-line settlement-attention',
  completed: 'i-mingcute-check-circle-line settlement-done',
  failed: 'i-mingcute-close-circle-line settlement-failed',
  cancelled: 'i-mingcute-forbid-circle-line'
};
const visible = computed(() =>
  settlement.batches.filter(batch => filter.value === 'all' || !['completed', 'cancelled'].includes(batch.status))
);
const pendingFacts = computed(() => visible.value.reduce((sum, batch) => sum + batch.pending, 0));
const subtitle = computed(() =>
  visible.value.length
    ? `${visible.value.length} 批 · ${pendingFacts.value} 项待确认`
    : (editor.activeTab?.path ?? '未打开正文')
);
onMounted(settlement.refresh);
watch(() => workspace.rootPath, settlement.refresh);
</script>
<template>
  <AppPanel class="settlement-panel" title="章节结算" title-hidden :subtitle="subtitle">
    <template #toolbar>
      <AppSelect v-model="filter" aria-label="结算状态筛选" class="app-panel-toolbar-full">
        <AppSelectItem value="pending">待处理</AppSelectItem>
        <AppSelectItem value="all">全部结算</AppSelectItem>
      </AppSelect>
    </template>

    <AppNotice v-if="settlement.error" tone="error">{{ settlement.error }}</AppNotice>
    <div v-for="run in settlement.running" :key="run.id" class="settlement-running" role="status">
      <span class="i-mingcute-loading-3-line animate-spin size-4 shrink-0" aria-hidden="true" />
      <span class="settlement-running-label">{{ run.chapterPath }} · 结算中</span>
      <AppTooltip text="取消结算" side="bottom" :side-offset="3">
        <AppButton icon variant="ghost" size="xs" aria-label="取消结算" @click="settlement.cancel(run.id)">
          <span class="i-mingcute-stop-line" />
        </AppButton>
      </AppTooltip>
    </div>
    <AppListItem
      v-for="batch in visible"
      :key="batch.id"
      class="settlement-entry"
      :title="batch.chapterTitle"
      :description="batch.chapterPath"
      :meta="`${labels[batch.status]} · ${batch.pending} 项待确认`"
      :selected="settlement.details?.batch.id === batch.id"
      @click="settlement.read(batch.id)"
    >
      <template #leading><span :class="icons[batch.status]" class="size-4" aria-hidden="true" /></template>
    </AppListItem>
    <AppEmptyState
      v-if="!visible.length && !settlement.running.length"
      icon="i-mingcute-inbox-2-line"
      :title="filter === 'pending' ? '没有待处理结算' : '还没有结算记录'"
      description="章节写完后结算一次：摘要与角色、时间线的新事实会以提议形式等你确认。"
    >
      <AppButton v-if="filter === 'pending'" size="xs" variant="ghost" @click="filter = 'all'">查看全部结算</AppButton>
    </AppEmptyState>
    <AppNotice v-for="diagnostic in settlement.diagnostics" :key="diagnostic" tone="error">{{ diagnostic }}</AppNotice>

    <template #footer>
      <AppButton
        size="sm"
        variant="primary"
        :disabled="settlement.busy || !workspace.rootPath"
        @click="settlement.prepare()"
      >
        结算当前章节
      </AppButton>
    </template>
  </AppPanel>
</template>
<style scoped lang="scss">
.settlement-running {
  @apply flex items-center gap-2 px-3 py-1.5;
  font-size: var(--ui-caption-size);
  color: var(--muted-foreground);
}
.settlement-running-label {
  @apply min-w-0 flex-1 truncate;
}
.settlement-attention {
  color: var(--warning);
}
.settlement-done {
  color: var(--success);
}
.settlement-failed {
  color: var(--destructive);
}
</style>
