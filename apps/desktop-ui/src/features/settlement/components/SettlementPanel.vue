<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppScrollArea } from '@/components/AppScrollArea';
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
  <section class="settlement-panel" aria-label="章节结算">
    <header>
      <strong>章节结算</strong>
      <AppButton icon variant="ghost" size="xs" aria-label="刷新结算" @click="settlement.refresh"
        ><span class="i-mingcute-refresh-2-line"
      /></AppButton>
    </header>
    <div class="settlement-filter">
      <AppSelect v-model="filter" aria-label="结算状态筛选">
        <AppSelectItem value="pending">待处理</AppSelectItem><AppSelectItem value="all">全部结算</AppSelectItem>
      </AppSelect>
    </div>
    <AppScrollArea class="settlement-list">
      <p v-if="settlement.error" role="alert">{{ settlement.error }}</p>
      <div v-for="run in settlement.running" :key="run.id" class="settlement-running" role="status">
        <span>{{ run.chapterPath }} · 结算中</span>
        <AppButton icon variant="ghost" size="xs" aria-label="取消结算" @click="settlement.cancel(run.id)"
          ><span class="i-mingcute-stop-line"
        /></AppButton>
      </div>
      <AppButton
        v-for="batch in visible"
        :key="batch.id"
        variant="ghost"
        class="settlement-entry"
        @click="settlement.read(batch.id)"
      >
        <span>{{ batch.chapterTitle }}</span
        ><small>{{ batch.chapterPath }} · {{ labels[batch.status] }} · {{ batch.pending }} 项待确认</small>
      </AppButton>
      <p v-if="!visible.length && !settlement.running.length">没有待处理结算</p>
      <p v-for="diagnostic in settlement.diagnostics" :key="diagnostic" role="alert">{{ diagnostic }}</p>
    </AppScrollArea>
    <footer>
      <AppButton :disabled="settlement.busy || !workspace.rootPath" @click="settlement.prepare()"
        >结算当前章节</AppButton
      >
    </footer>
  </section>
</template>
<style scoped lang="scss">
.settlement-panel {
  @apply flex min-h-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex min-h-9 items-center justify-between border-b px-3;
  border-color: var(--border-subtle);
}
strong {
  @apply font-medium;
}
.settlement-filter {
  @apply p-3;
}
.settlement-list {
  @apply min-h-0 flex-1 px-3;
}
.settlement-entry {
  @apply mb-1 w-full flex-col items-start gap-1 text-left;
}
small {
  @apply block w-full break-words font-normal;
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.settlement-running {
  @apply flex items-center gap-2;
}
.settlement-running span {
  @apply min-w-0 flex-1 break-words;
}
footer {
  @apply flex shrink-0 justify-end border-t p-3;
  border-color: var(--border-subtle);
}
p {
  @apply break-words;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
