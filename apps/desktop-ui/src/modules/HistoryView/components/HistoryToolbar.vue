<script setup lang="ts">
import AppDropdownMenu from '../../../components/AppDropdownMenu/AppDropdownMenu.vue';
import AppDropdownMenuItem from '../../../components/AppDropdownMenu/AppDropdownMenuItem.vue';
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
</script>

<template>
  <div class="history-toolbar">
    <div class="history-toolbar-title-row">
      <div class="history-title-group">
        <button class="history-back-button" type="button" aria-label="返回" @click="handleBackClick">
          <span class="i-mingcute-left-line" aria-hidden="true" />
        </button>
        <h1 id="history-title" class="history-title">历史记录</h1>
      </div>
      <button type="button" class="history-selection-mode-button" @click="emit('toggleSelectionMode')">
        <span class="i-mingcute-list-check-line" aria-hidden="true" />
        <span>{{ props.isSelectionMode ? '退出多选' : '多选模式' }}</span>
      </button>
    </div>

    <label class="history-search" aria-label="搜索历史记录">
      <span class="i-mingcute-search-line" aria-hidden="true" />
      <input v-model="searchQuery" type="search" placeholder="模糊搜索历史记录..." />
      <button v-if="searchQuery" class="history-search-clear" type="button" aria-label="清空搜索" @click="clearSearch">
        <span class="i-mingcute-close-line" aria-hidden="true" />
      </button>
    </label>

    <div class="history-controls" aria-label="历史记录筛选与排序">
      <AppDropdownMenu trigger-class="history-control" content-size="sm" :side-offset="4">
        <template #trigger="{ triggerClass, disabled, dataDisabled }">
          <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
            <span class="history-control-label">工作区</span>
            <span class="history-control-value">{{ getScopeLabel(scopeFilter) }}</span>
            <span class="i-mingcute-down-line history-control-icon" aria-hidden="true" />
          </button>
        </template>
        <AppDropdownMenuItem
          v-for="option in scopeOptions"
          :key="option.value"
          density="sm"
          :active="option.value === scopeFilter"
          @select="scopeFilter = option.value"
        >
          {{ option.label }}
        </AppDropdownMenuItem>
      </AppDropdownMenu>

      <AppDropdownMenu trigger-class="history-control" content-size="sm" :side-offset="4">
        <template #trigger="{ triggerClass, disabled, dataDisabled }">
          <button :class="triggerClass" type="button" :disabled="disabled" :data-disabled="dataDisabled">
            <span class="history-control-label">排序</span>
            <span class="history-control-value">{{ getSortLabel(sortMode) }}</span>
            <span class="i-mingcute-down-line history-control-icon" aria-hidden="true" />
          </button>
        </template>
        <AppDropdownMenuItem
          v-for="option in sortOptions"
          :key="option.value"
          density="sm"
          :active="option.value === sortMode"
          @select="sortMode = option.value"
        >
          {{ option.label }}
        </AppDropdownMenuItem>
      </AppDropdownMenu>
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

.history-back-button {
  @apply flex-center size-8 shrink-0 border-0 bg-transparent text-lg outline-none transition-colors duration-150;

  border-radius: calc(var(--radius) * 0.5);
  color: var(--muted-foreground);
}

.history-back-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.history-back-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-title {
  @apply m-0 text-xl font-semibold;

  color: var(--foreground);
}

.history-selection-mode-button {
  @apply inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium outline-none transition-colors duration-150;

  background: var(--surface-acrylic-strong);
  border-color: var(--border-subtle);
  color: var(--muted-foreground);
}

.history-selection-mode-button:hover {
  background: var(--surface-muted);
  color: var(--foreground);
}

.history-selection-mode-button:focus-visible {
  box-shadow: var(--input-focus-shadow);
}

.history-search {
  @apply flex items-center gap-2 border px-3 py-2 text-sm;

  background: var(--surface-muted);
  border-color: var(--border-subtle);
  border-radius: calc(var(--radius) * 0.5);
  color: var(--muted-foreground);
}

.history-search:focus-within {
  border-color: var(--input-focus-border);
  box-shadow: var(--input-focus-shadow);
}

.history-search input {
  @apply min-w-0 flex-1 border-0 bg-transparent p-0 text-sm outline-none;

  color: var(--foreground);
}

.history-search input::placeholder {
  color: var(--input-placeholder);
}

.history-search-clear {
  @apply flex-center size-5 shrink-0 border-0 bg-transparent p-0 text-sm outline-none transition-colors duration-150;

  border-radius: 999px;
  color: var(--muted-foreground);
}

.history-search-clear:hover {
  color: var(--foreground);
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
