import { sift } from 'radash';
import { computed, type Ref } from 'vue';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { getSessionTitle } from '@/utils/session-display';
import { isSameWorkspacePath } from '@/utils/workspace-path';

/** 不筛任何目录；其余取值都是某个会话所在的作品目录（开放集合，故不写成联合类型）。 */
export const HISTORY_SCOPE_ALL = 'all';
export type HistoryScopeFilter = string;
export type HistorySortMode = 'latest' | 'oldest' | 'tokens';
export type HistoryScopeOption = { value: string; label: string };

/**
 * 生成历史页的筛选、搜索和排序投影，不修改 store 中的原始会话顺序。
 * 筛选项来自会话本身：会话分布在哪些目录，就给哪些目录；当前作品排最前并标「当前」。
 * 选中的目录若已不存在（换了作品、目录被删空），回退到"全部"，避免筛出一片空白。
 */
export function useHistorySessions(options: {
  sessions: Ref<ChaptaleSessionListItem[]>;
  searchQuery: Ref<string>;
  scopeFilter: Ref<HistoryScopeFilter>;
  sortMode: Ref<HistorySortMode>;
  currentWorkspacePath: Ref<string>;
}) {
  const normalizedSearchQuery = computed(() => options.searchQuery.value.trim().toLowerCase());
  const scopeOptions = computed(() => collectScopeOptions(options.sessions.value, options.currentWorkspacePath.value));
  const activeScope = computed(() => {
    const selected = options.scopeFilter.value;

    if (selected === HISTORY_SCOPE_ALL || scopeOptions.value.some(option => option.value === selected)) {
      return selected;
    }

    return HISTORY_SCOPE_ALL;
  });

  const filteredSessions = computed(() => {
    const query = normalizedSearchQuery.value;

    return options.sessions.value
      .filter(session => matchesScope(session, activeScope.value))
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
    resultCountText,
    scopeOptions
  };
}

/** 全部 + 每个会话目录一项；当前作品在最前，其余按最近使用时间倒序。 */
function collectScopeOptions(sessions: ChaptaleSessionListItem[], currentWorkspacePath: string): HistoryScopeOption[] {
  const latestByCwd = new Map<string, string>();

  for (const session of sessions) {
    if (!session.cwd) {
      continue;
    }

    const latest = latestByCwd.get(session.cwd);

    if (!latest || session.updatedAt > latest) {
      latestByCwd.set(session.cwd, session.updatedAt);
    }
  }

  const directories = [...latestByCwd.keys()]
    .filter(cwd => !isSameWorkspacePath(cwd, currentWorkspacePath))
    .toSorted((left, right) => (latestByCwd.get(right) ?? '').localeCompare(latestByCwd.get(left) ?? ''));
  const currentFirst = currentWorkspacePath && latestByCwd.has(currentWorkspacePath) ? [currentWorkspacePath] : [];

  return [
    { value: HISTORY_SCOPE_ALL, label: '全部' },
    ...currentFirst.map(cwd => ({ value: cwd, label: `${cwd} · 当前` })),
    ...directories.map(cwd => ({ value: cwd, label: cwd }))
  ];
}

function matchesScope(session: ChaptaleSessionListItem, scope: HistoryScopeFilter) {
  return scope === HISTORY_SCOPE_ALL || isSameWorkspacePath(session.cwd, scope);
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

  if (sortMode === 'tokens') {
    return right.totalTokens - left.totalTokens || right.updatedAt.localeCompare(left.updatedAt);
  }

  return right.updatedAt.localeCompare(left.updatedAt);
}
