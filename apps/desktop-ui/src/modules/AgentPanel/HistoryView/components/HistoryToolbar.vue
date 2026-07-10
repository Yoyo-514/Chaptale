<script setup lang="ts">
import { AppButton } from '@/components/AppButton';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import type { HistoryScopeFilter, HistorySortMode } from '../composables/useHistorySessions';

const props = defineProps<{
  isSelectionMode: boolean;
}>();

const emit = defineEmits<{
  toggleSelectionMode: [];
}>();

const searchQuery = defineModel<string>('searchQuery', { required: true });
const scopeFilter = defineModel<HistoryScopeFilter>('scopeFilter', { required: true });
const sortMode = defineModel<HistorySortMode>('sortMode', { required: true });

const scopeOptions: { value: HistoryScopeFilter; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'workspace', label: '工作区' },
  { value: 'global', label: '全局' }
];

const sortOptions: { value: HistorySortMode; label: string }[] = [
  { value: 'latest', label: '最新' },
  { value: 'oldest', label: '最旧' },
  { value: 'cost', label: '费用' },
  { value: 'tokens', label: 'Token' }
];

function noop() {}

function goBack() {
  if (window.history.length > 1) {
    window.history.back();
  }
}

function handleBackClick() {
  try {
    goBack();
  } catch {
    noop();
  }
}

function clearSearch() {
  searchQuery.value = '';
}

function getScopeLabel(value: HistoryScopeFilter) {
  return scopeOptions.find(option => option.value === value)?.label ?? '全部';
}

function getSortLabel(value: HistorySortMode) {
  return sortOptions.find(option => option.value === value)?.label ?? '最新';
}

function selectScopeFilter(value: string) {
  scopeFilter.value = value as HistoryScopeFilter;
}

function selectSortMode(value: string) {
  sortMode.value = value as HistorySortMode;
}
</script>

<template>
  <div class="history-toolbar">
    <div class="history-toolbar-title-row">
      <div class="history-title-group">
        <AppButton
          icon
          variant="ghost"
          size="md"
          class="history-back-button"
          type="button"
          aria-label="返回"
          @click="handleBackClick"
        >
          <span class="i-mingcute-left-line size-5" aria-hidden="true" />
        </AppButton>
        <h1 id="history-title" class="history-title">历史记录</h1>
      </div>
      <AppButton
        type="button"
        variant="outline"
        class="history-selection-mode-button"
        @click="emit('toggleSelectionMode')"
      >
        <span class="i-mingcute-list-check-line size-4" aria-hidden="true" />
        <span>{{ props.isSelectionMode ? '退出多选' : '多选模式' }}</span>
      </AppButton>
    </div>

    <AppInput
      v-model="searchQuery"
      class="history-search"
      type="search"
      size="md"
      variant="muted"
      aria-label="搜索历史记录"
      placeholder="模糊搜索历史记录..."
    >
      <template #prefix>
        <span class="i-mingcute-search-line size-4" aria-hidden="true" />
      </template>
      <template v-if="searchQuery" #suffix>
        <AppButton
          icon
          variant="ghost"
          size="xs"
          class="history-search-clear"
          type="button"
          aria-label="清空搜索"
          @click="clearSearch"
        >
          <span class="i-mingcute-close-line size-4" aria-hidden="true" />
        </AppButton>
      </template>
    </AppInput>

    <div class="history-controls" aria-label="历史记录筛选与排序">
      <AppSelect
        :model-value="scopeFilter"
        trigger-class="history-control"
        content-size="sm"
        :side-offset="4"
        @update:model-value="selectScopeFilter"
      >
        <template #trigger="{ triggerClass, disabled, dataDisabled }">
          <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
            <span class="history-control-label">工作区</span>
            <span class="history-control-value">{{ getScopeLabel(scopeFilter) }}</span>
            <span class="i-mingcute-down-line history-control-icon" aria-hidden="true" />
          </button>
        </template>
        <AppSelectItem v-for="option in scopeOptions" :key="option.value" :value="option.value" density="sm">
          {{ option.label }}
        </AppSelectItem>
      </AppSelect>

      <AppSelect
        :model-value="sortMode"
        trigger-class="history-control"
        content-size="sm"
        :side-offset="4"
        @update:model-value="selectSortMode"
      >
        <template #trigger="{ triggerClass, disabled, dataDisabled }">
          <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
            <span class="history-control-label">排序</span>
            <span class="history-control-value">{{ getSortLabel(sortMode) }}</span>
            <span class="i-mingcute-down-line history-control-icon" aria-hidden="true" />
          </button>
        </template>
        <AppSelectItem v-for="option in sortOptions" :key="option.value" :value="option.value" density="sm">
          {{ option.label }}
        </AppSelectItem>
      </AppSelect>
    </div>
  </div>
</template>

<style scoped lang="scss">
.history-toolbar {
  @apply mx-auto flex w-full max-w-4xl flex-col gap-3;
}

.history-toolbar-title-row {
  @apply flex items-center justify-between gap-4;
}

.history-title-group {
  @apply flex min-w-0 items-center gap-2;
}

.history-title {
  @apply m-0 text-xl font-semibold;

  color: var(--foreground);
}

.history-selection-mode-button {
  @apply rounded-full py-1;

  background: var(--surface-acrylic-strong);
  color: var(--muted-foreground);
}

.history-search {
  border-radius: calc(var(--radius) * 0.5);
}

.history-search:focus-within {
  border-color: var(--input-focus-border);
}

.history-search :deep(.app-input-control::placeholder) {
  color: var(--input-placeholder);
}

.history-search-clear {
  @apply size-5 shrink-0 rounded-full;
}

.history-controls {
  @apply grid grid-cols-2 gap-3;
}

.history-control {
  @apply gap-3 px-3 py-2 text-sm;

  background: var(--surface-acrylic-subtle);
  border-color: var(--border-subtle);
  color: var(--foreground);
}

.history-control:hover {
  background: var(--surface-muted);
}

.history-control:focus-visible {
  border-color: var(--input-focus-border);
}

.history-control-label {
  @apply shrink-0 font-medium;
}

.history-control-value {
  @apply min-w-0 flex-1 truncate text-right;

  color: var(--muted-foreground);
}

.history-control-icon {
  @apply shrink-0 text-base transition-transform duration-150;

  color: var(--muted-foreground);
}

.history-control[data-state='open'] .history-control-icon {
  transform: rotate(180deg);
}
</style>
