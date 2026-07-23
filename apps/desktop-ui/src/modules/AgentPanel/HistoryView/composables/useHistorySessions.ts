import { sift } from 'radash';
import { computed, type Ref } from 'vue';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { getSessionTitle } from '@/utils/session-display';

export type HistoryScopeFilter = 'all' | 'workspace' | 'global';
export type HistorySortMode = 'latest' | 'oldest' | 'cost' | 'tokens';

/**
 * 生成历史页的筛选、搜索和排序投影，不修改 store 中的原始会话顺序。
 * workspace 筛选同时校验存储范围和规范化 cwd，避免把其他工作区会话混入当前项目。
 */
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

// 历史记录可能由不同平台写入，比较工作区时统一分隔符、尾斜杠和大小写。
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
