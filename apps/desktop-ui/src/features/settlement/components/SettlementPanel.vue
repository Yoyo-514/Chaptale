<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppListItem } from '@/components/AppListItem';
import { AppPanel } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useWorkspaceStore } from '@/features/workspace';

import { useSettlementStore } from '../store';

const settlement = useSettlementStore();
const workspace = useWorkspaceStore();
const filter = ref('pending');
const labels = { generating: '结算中', ready: '待确认事实', completed: '已结算', failed: '失败', cancelled: '已取消' };
const visible = computed(() =>
  settlement.batches.filter(batch => filter.value === 'all' || !['completed', 'cancelled'].includes(batch.status))
);
onMounted(settlement.refresh);
watch(() => workspace.rootPath, settlement.refresh);
</script>
<template>
  <AppPanel class="settlement-panel" title="章节结算" :count="visible.length">
    <template #actions>
      <AppButton icon variant="ghost" size="xs" aria-label="刷新结算" @click="settlement.refresh"
        ><span class="i-mingcute-refresh-2-line"
      /></AppButton>
    </template>
    <template #toolbar>
      <div class="settlement-filter">
        <AppSelect v-model="filter" aria-label="结算状态筛选">
          <AppSelectItem value="pending">待处理</AppSelectItem><AppSelectItem value="all">全部结算</AppSelectItem>
        </AppSelect>
      </div>
    </template>
    <div class="settlement-list">
      <p v-if="settlement.error" role="alert">{{ settlement.error }}</p>
      <div v-for="run in settlement.running" :key="run.id" class="settlement-running" role="status">
        <span>{{ run.chapterPath }} · 结算中</span>
        <AppButton icon variant="ghost" size="xs" aria-label="取消结算" @click="settlement.cancel(run.id)"
          ><span class="i-mingcute-stop-line"
        /></AppButton>
      </div>
      <AppListItem
        v-for="batch in visible"
        :key="batch.id"
        class="settlement-entry"
        :title="batch.chapterTitle"
        :description="batch.chapterPath"
        :meta="`${labels[batch.status]} · ${batch.pending} 项待确认`"
        @click="settlement.read(batch.id)"
      />
      <p v-if="!visible.length && !settlement.running.length">没有待处理结算</p>
      <p v-for="diagnostic in settlement.diagnostics" :key="diagnostic" role="alert">{{ diagnostic }}</p>
    </div>
    <template #footer>
      <AppButton :disabled="settlement.busy || !workspace.rootPath" @click="settlement.prepare()"
        >结算当前章节</AppButton
      >
    </template>
  </AppPanel>
</template>
<style scoped lang="scss">
.settlement-filter {
  @apply p-3;
}
.settlement-running {
  @apply flex items-center gap-2 px-3 py-2;
}
.settlement-running span {
  @apply min-w-0 flex-1 break-words;
}
p {
  @apply m-0 p-4;
  overflow-wrap: anywhere;
  color: var(--muted-foreground);
}
[role='alert'] {
  color: var(--destructive);
}
</style>
