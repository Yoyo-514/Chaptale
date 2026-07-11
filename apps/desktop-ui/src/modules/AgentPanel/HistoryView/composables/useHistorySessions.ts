import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import { sift } from 'radash';
import { computed, type Ref } from 'vue';

import { getSessionTitle } from '@/utils/session-display';

export type HistoryScopeFilter = 'all' | 'workspace' | 'global';
export type HistorySortMode = 'latest' | 'oldest' | 'cost' | 'tokens';

export function useHistorySessions(options: {
  sessions: Ref<ChaptaleSessionListItem[]>;
  searchQuery: Ref<string>;
  scopeFilter: Ref<HistoryScopeFilter>;
  sortMode: Ref<HistorySortMode>;
  currentWorkspacePath: Ref<string>;
}) {
  const normalizedSearchQuery = computed(() => options.searchQuery.value.trim().toLowerCase());

  const filteredSessions = computed(() => {
    const query = normalizedSearchQuery.value;

    return options.sessions.value
      .filter(session => matchesScope(session, options.scopeFilter.value, options.currentWorkspacePath.value))
      .filter(session => matchesSearch(session, query))
      .toSorted((left, right) => compareSessions(left, right, options.sortMode.value));
  });

  const resultCountText = computed(() => {
    if (filteredSessions.value.length === options.sessions.value.length) {
      return `${options.sessions.value.length} 个会话`;
    }

    return `${filteredSessions.value.length} / ${options.sessions.value.length} 个会话`;
  });

  return {
    filteredSessions,
    resultCountText
  };
}

function normalizePath(value: string) {
  return value.replaceAll('\\', '/').replace(/\/+$/, '').toLowerCase();
}

function matchesScope(session: ChaptaleSessionListItem, scope: HistoryScopeFilter, currentWorkspacePath: string) {
  if (scope === 'all') {
    return true;
  }

  if (scope === 'global') {
    return session.scope === 'global';
  }

  return (
    session.scope === 'workspace' &&
    Boolean(currentWorkspacePath) &&
    normalizePath(session.cwd) === normalizePath(currentWorkspacePath)
  );
}

function matchesSearch(session: ChaptaleSessionListItem, query: string) {
  if (!query) {
    return true;
  }

  const searchableText = sift([
    getSessionTitle(session),
    session.lastMessagePreview,
    session.cwd,
    session.path,
    session.id
  ])
    .join('\n')
    .toLowerCase();

  return searchableText.includes(query);
}

function compareSessions(left: ChaptaleSessionListItem, right: ChaptaleSessionListItem, sortMode: HistorySortMode) {
  if (sortMode === 'oldest') {
    return left.updatedAt.localeCompare(right.updatedAt);
  }

  if (sortMode === 'cost') {
    return right.totalCost - left.totalCost || right.updatedAt.localeCompare(left.updatedAt);
  }

  if (sortMode === 'tokens') {
    return right.totalTokens - left.totalTokens || right.updatedAt.localeCompare(left.updatedAt);
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}
