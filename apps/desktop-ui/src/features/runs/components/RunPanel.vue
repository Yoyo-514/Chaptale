<script setup lang="ts">
import { computed, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppEmptyState } from '@/components/AppEmptyState';
import { AppInput } from '@/components/AppInput';
import { AppListItem } from '@/components/AppListItem';
import { AppNotice } from '@/components/AppNotice';
import { AppPanel } from '@/components/AppPanel';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { AppTooltip } from '@/components/AppTooltip';

import { RUN_PERSONA_LABELS, RUN_STATUS_LABELS, runTitle } from '../presentation';
import { useRunStore } from '../store';

const runs = useRunStore();
const personas = computed(() => [
  ...new Set([...Object.keys(RUN_PERSONA_LABELS), ...runs.records.map(item => item.personaId)])
]);
const icons: Record<keyof typeof RUN_STATUS_LABELS, string> = {
  success: 'i-mingcute-check-circle-line run-done',
  failed: 'i-mingcute-close-circle-line run-failed',
  cancelled: 'i-mingcute-forbid-circle-line',
  timeout: 'i-mingcute-time-line run-warning'
};
const filtered = computed(() => Boolean(runs.query) || runs.personaId !== '__all' || runs.status !== '__all');
const subtitle = computed(() =>
  runs.records.length ? `${runs.records.length} 条${runs.nextCursor ? '（还有更早）' : ''}` : '按作品记录每次模型调用'
);
function timeLabel(value: string) {
  return new Date(value).toLocaleString(undefined, {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  });
}
onMounted(() => void runs.refresh());
</script>
<template>
  <AppPanel class="run-panel" title="运行记录" title-hidden :subtitle="subtitle">
    <template #actions>
      <AppTooltip text="刷新运行记录" side="bottom" :side-offset="3">
        <AppButton
          icon
          size="xs"
          variant="ghost"
          aria-label="刷新运行记录"
          :disabled="runs.loading"
          @click="runs.refresh()"
        >
          <span class="i-mingcute-refresh-3-line" />
        </AppButton>
      </AppTooltip>
    </template>
    <template #toolbar>
      <AppInput
        v-model="runs.query"
        class="app-panel-toolbar-full"
        aria-label="搜索运行记录"
        placeholder="任务、文件或运行 ID"
      >
        <template #prefix><span class="i-mingcute-search-line" /></template>
        <template v-if="runs.query" #suffix>
          <AppButton icon variant="ghost" size="xs" aria-label="清除运行筛选" @click="runs.query = ''">
            <span class="i-mingcute-close-line" />
          </AppButton>
        </template>
      </AppInput>
      <AppSelect v-model="runs.personaId" aria-label="运行角色">
        <AppSelectItem value="__all">全部角色</AppSelectItem>
        <AppSelectItem v-for="id in personas" :key="id" :value="id">{{ RUN_PERSONA_LABELS[id] ?? id }}</AppSelectItem>
      </AppSelect>
      <AppSelect v-model="runs.status" aria-label="运行状态">
        <AppSelectItem value="__all">全部状态</AppSelectItem>
        <AppSelectItem v-for="(label, id) in RUN_STATUS_LABELS" :key="id" :value="id">{{ label }}</AppSelectItem>
      </AppSelect>
    </template>

    <AppNotice v-if="runs.error" tone="error">{{ runs.error }}</AppNotice>
    <AppNotice v-for="(item, index) in runs.diagnostics" :key="index" tone="error">
      {{ item.filePath }}:{{ item.line }} · {{ item.message }}
    </AppNotice>
    <AppNotice v-if="runs.loading && !runs.records.length">正在读取运行记录</AppNotice>
    <AppEmptyState
      v-else-if="!runs.records.length"
      icon="i-mingcute-history-line"
      :title="filtered ? '没有符合条件的运行记录' : '还没有运行记录'"
      :description="
        filtered ? '换个关键词或放宽角色与状态。' : '候选、审查与结算每次调用模型都会留下记录，可回看输入来源与用量。'
      "
    />
    <AppListItem
      v-for="record in runs.records"
      :key="record.id"
      class="run-row"
      :title="runTitle(record)"
      :description="`${RUN_PERSONA_LABELS[record.personaId] ?? record.personaId} · ${RUN_STATUS_LABELS[record.status]}`"
      :meta="`${timeLabel(record.createdAt)} · ${record.usage.inputTokens + record.usage.outputTokens} tokens`"
      :selected="runs.selected?.id === record.id"
      @click="runs.select(record)"
    >
      <template #leading><span :class="icons[record.status]" class="size-4" aria-hidden="true" /></template>
    </AppListItem>
    <div v-if="runs.nextCursor" class="run-more">
      <AppButton size="xs" variant="ghost" :disabled="runs.loading" @click="runs.refresh(true)">加载更早记录</AppButton>
    </div>
  </AppPanel>
</template>
<style scoped lang="scss">
.run-more {
  @apply flex justify-center py-2;
}
.run-done {
  color: var(--success);
}
.run-failed {
  color: var(--destructive);
}
.run-warning {
  color: var(--warning);
}
</style>
