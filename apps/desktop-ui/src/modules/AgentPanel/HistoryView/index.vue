<script setup lang="ts">
import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import { computed, onMounted, ref, watch } from 'vue';
import { useRouter } from 'vue-router';

import { AppScrollArea } from '@/components/AppScrollArea';
import { useSessionStore } from '@/stores/session';
import HistorySelectionBar from './components/HistorySelectionBar.vue';
import HistorySelectionToolbar from './components/HistorySelectionToolbar.vue';
import HistorySessionList from './components/HistorySessionList.vue';
import HistoryToolbar from './components/HistoryToolbar.vue';
import { useHistorySessions } from './composables/useHistorySessions';

import type { HistoryScopeFilter, HistorySortMode } from './composables/useHistorySessions';

const router = useRouter();
const sessionStore = useSessionStore();

const searchQuery = ref('');
const scopeFilter = ref<HistoryScopeFilter>('all');
const sortMode = ref<HistorySortMode>('latest');
const isSelectionMode = ref(false);
const selectedIds = ref(new Set<string>());
const sessions = computed(() => sessionStore.sessions);
const { filteredSessions } = useHistorySessions({
  sessions,
  searchQuery,
  scopeFilter,
  sortMode
});
const selectedCount = computed(() => selectedIds.value.size);

watch(filteredSessions, visibleSessions => {
  const visibleIds = new Set(visibleSessions.map(session => session.id));
  const nextSelectedIds = new Set([...selectedIds.value].filter(id => visibleIds.has(id)));

  if (nextSelectedIds.size !== selectedIds.value.size) {
    selectedIds.value = nextSelectedIds;
  }
});

onMounted(() => {
  void sessionStore.loadSessions();
  void sessionStore.loadStorageDebugInfo();
});

async function handleSelectSession(session: ChaptaleSessionListItem) {
  await sessionStore.selectSession(session.id);
  await router.push({ name: 'chat' });
}

async function handleDeleteSession(sessionId: string) {
  await sessionStore.deleteSession(sessionId);
}

function toggleSelectionMode() {
  isSelectionMode.value = !isSelectionMode.value;

  if (!isSelectionMode.value) {
    clearSelection();
  }
}

function toggleSessionSelection(sessionId: string) {
  const nextSelectedIds = new Set(selectedIds.value);

  if (nextSelectedIds.has(sessionId)) {
    nextSelectedIds.delete(sessionId);
  } else {
    nextSelectedIds.add(sessionId);
  }

  selectedIds.value = nextSelectedIds;
}

function toggleAllVisibleSessions() {
  const visibleIds = filteredSessions.value.map(session => session.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every(id => selectedIds.value.has(id));
  const nextSelectedIds = new Set(selectedIds.value);

  if (allVisibleSelected) {
    for (const id of visibleIds) {
      nextSelectedIds.delete(id);
    }
  } else {
    for (const id of visibleIds) {
      nextSelectedIds.add(id);
    }
  }

  selectedIds.value = nextSelectedIds;
}

function clearSelection() {
  selectedIds.value = new Set();
}

async function deleteSelectedSessions() {
  await sessionStore.deleteSessions([...selectedIds.value]);
  clearSelection();
  isSelectionMode.value = false;
}
</script>

<template>
  <section class="history-view" aria-labelledby="history-title">
    <header class="history-toolbar-shell">
      <HistoryToolbar
        v-model:search-query="searchQuery"
        v-model:scope-filter="scopeFilter"
        v-model:sort-mode="sortMode"
        :is-selection-mode="isSelectionMode"
        @toggle-selection-mode="toggleSelectionMode"
      />
      <HistorySelectionToolbar
        v-if="isSelectionMode"
        :selected-count="selectedCount"
        :total-count="filteredSessions.length"
        @toggle-all="toggleAllVisibleSessions"
      />
    </header>

    <AppScrollArea class="history-content" viewport-class="history-content-viewport">
      <HistorySessionList
        :sessions="filteredSessions"
        :current-session-id="sessionStore.currentSessionId"
        :total-session-count="sessions.length"
        :is-loading="sessionStore.isLoading"
        :error="sessionStore.error"
        :is-selection-mode="isSelectionMode"
        :selected-ids="selectedIds"
        @select="handleSelectSession"
        @delete="handleDeleteSession"
        @toggle-select="toggleSessionSelection"
      />
    </AppScrollArea>

    <HistorySelectionBar
      v-if="isSelectionMode"
      :selected-count="selectedCount"
      :total-count="filteredSessions.length"
      @clear="clearSelection"
      @delete-selected="deleteSelectedSessions"
    />
  </section>
</template>

<style scoped lang="scss">
.history-view {
  @apply flex min-w-0 flex-1 flex-col overflow-hidden;
}

.history-toolbar-shell {
  @apply sticky top-0 z-10 shrink-0 border-b px-4 pt-3 pb-4;

  background: var(--mica-background);
  border-color: var(--border-subtle);
}

.history-content {
  @apply min-h-0 flex-1;
}

.history-content :deep(.history-content-viewport) {
  @apply px-4 pb-8;
}
</style>
