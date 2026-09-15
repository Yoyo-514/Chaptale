<script setup lang="ts">
import { computed, onMounted } from 'vue';

import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppListItem } from '@/components/AppListItem';
import { AppPanel } from '@/components/AppPanel';
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
  <AppPanel class="run-panel" title="运行记录" :count="runs.records.length">
    <template #actions>
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
    </template>
    <template #toolbar>
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
            <AppSelectItem v-for="id in personas" :key="id" :value="id">{{
              RUN_PERSONA_LABELS[id] ?? id
            }}</AppSelectItem>
          </AppSelect>
          <AppSelect v-model="runs.status" aria-label="运行状态">
            <AppSelectItem value="__all">全部状态</AppSelectItem>
            <AppSelectItem v-for="(label, id) in RUN_STATUS_LABELS" :key="id" :value="id">{{ label }}</AppSelectItem>
          </AppSelect>
        </div>
      </div>
    </template>
    <div class="run-list">
      <p v-if="runs.error" role="alert">{{ runs.error }}</p>
      <p v-for="(item, index) in runs.diagnostics" :key="index" role="alert">
        {{ item.filePath }}:{{ item.line }} · {{ item.message }}
      </p>
      <p v-if="runs.loading && !runs.records.length" role="status">正在读取运行记录</p>
      <p v-else-if="!runs.records.length">没有符合条件的运行记录</p>
      <AppListItem
        v-for="record in runs.records"
        :key="record.id"
        class="run-row"
        :title="runTitle(record)"
        :description="`${RUN_PERSONA_LABELS[record.personaId] ?? record.personaId} · ${RUN_STATUS_LABELS[record.status]}`"
        :meta="`${new Date(record.createdAt).toLocaleString()} · ${record.usage.inputTokens + record.usage.outputTokens} tokens`"
        @click="runs.select(record)"
      />
      <AppButton v-if="runs.nextCursor" class="run-more" :disabled="runs.loading" @click="runs.refresh(true)"
        >加载更早记录</AppButton
      >
    </div>
  </AppPanel>
</template>
<style scoped lang="scss">
.run-filters {
  @apply flex flex-col gap-2 p-3;
}
.run-selects {
  @apply grid gap-2;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 7.5rem), 1fr));
}
.run-list p {
  @apply m-0 p-4;
  overflow-wrap: anywhere;
  color: var(--muted-foreground);
}
.run-more {
  @apply m-3;
}
.run-list [role='alert'] {
  color: var(--destructive);
}
</style>
