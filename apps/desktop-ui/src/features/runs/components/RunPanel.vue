<script setup lang="ts">
import { computed, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';

import { RUN_PERSONA_LABELS, RUN_STATUS_LABELS, runTitle } from '../presentation';
import { useRunStore } from '../store';

const runs = useRunStore();
const personas = computed(() => [
  ...new Set([...Object.keys(RUN_PERSONA_LABELS), ...runs.records.map(item => item.personaId)])
]);
onMounted(() => void runs.refresh());
</script>
<template>
  <section class="run-panel" aria-label="运行记录">
    <header>
      <span>运行记录</span>
      <AppButton
        icon
        size="xs"
        variant="ghost"
        aria-label="刷新运行记录"
        title="刷新运行记录"
        :disabled="runs.loading"
        @click="runs.refresh()"
      >
        <span class="i-mingcute-refresh-3-line size-4" />
      </AppButton>
    </header>
    <div class="run-filters">
      <AppInput v-model="runs.query" aria-label="搜索运行记录" placeholder="任务、文件或运行 ID">
        <template #prefix><span class="i-mingcute-search-line size-4" /></template>
        <template v-if="runs.query" #suffix>
          <AppButton
            icon
            variant="ghost"
            size="xs"
            aria-label="清除运行筛选"
            title="清除运行筛选"
            @click="runs.query = ''"
          >
            <span class="i-mingcute-close-line size-4" />
          </AppButton>
        </template>
      </AppInput>
      <div class="run-selects">
        <AppSelect v-model="runs.personaId" aria-label="运行角色">
          <AppSelectItem value="__all">全部角色</AppSelectItem>
          <AppSelectItem v-for="id in personas" :key="id" :value="id">{{ RUN_PERSONA_LABELS[id] ?? id }}</AppSelectItem>
        </AppSelect>
        <AppSelect v-model="runs.status" aria-label="运行状态">
          <AppSelectItem value="__all">全部状态</AppSelectItem>
          <AppSelectItem v-for="(label, id) in RUN_STATUS_LABELS" :key="id" :value="id">{{ label }}</AppSelectItem>
        </AppSelect>
      </div>
    </div>
    <AppScrollArea class="run-list">
      <p v-if="runs.error" role="alert">{{ runs.error }}</p>
      <p v-for="(item, index) in runs.diagnostics" :key="index" role="alert">
        {{ item.filePath }}:{{ item.line }} · {{ item.message }}
      </p>
      <p v-if="runs.loading && !runs.records.length" role="status">正在读取运行记录</p>
      <p v-else-if="!runs.records.length">没有符合条件的运行记录</p>
      <AppButton
        v-for="record in runs.records"
        :key="record.id"
        variant="ghost"
        class="run-row"
        @click="runs.select(record)"
      >
        <strong>{{ runTitle(record) }}</strong>
        <span
          >{{ RUN_PERSONA_LABELS[record.personaId] ?? record.personaId }} · {{ RUN_STATUS_LABELS[record.status] }}</span
        >
        <small
          >{{ new Date(record.createdAt).toLocaleString() }} ·
          {{ record.usage.inputTokens + record.usage.outputTokens }} tokens</small
        >
      </AppButton>
      <AppButton v-if="runs.nextCursor" class="run-more" :disabled="runs.loading" @click="runs.refresh(true)"
        >加载更早记录</AppButton
      >
    </AppScrollArea>
  </section>
</template>
<style scoped lang="scss">
.run-panel {
  @apply flex min-h-0 min-w-0 flex-1 flex-col;
  font-size: var(--ui-font-size);
}
header {
  @apply flex h-9 shrink-0 items-center justify-between border-b px-3;
  border-color: var(--border-subtle);
}
.run-filters {
  @apply flex shrink-0 flex-col gap-2 border-b p-3;
  border-color: var(--border-subtle);
}
.run-selects {
  @apply grid gap-2;
  grid-template-columns: repeat(auto-fit, minmax(125px, 1fr));
}
.run-list {
  @apply min-h-0 flex-1;
}
.run-list p {
  @apply p-3;
  overflow-wrap: anywhere;
}
.run-row {
  @apply flex w-full flex-col items-start gap-1 rounded-none border-0 border-b p-3 text-left;
  border-color: var(--border-subtle);
  overflow-wrap: anywhere;
}
.run-row strong {
  @apply line-clamp-2 font-medium;
}
.run-row span,
small {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.run-more {
  @apply m-3;
}
[role='alert'] {
  color: var(--destructive);
}
</style>
