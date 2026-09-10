import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { HISTORY_SCOPE_ALL, useHistorySessions } from '../useHistorySessions';

function createSession(id: string, cwd: string, updatedAt = '2026-07-11T00:00:00.000Z'): ChaptaleSessionListItem {
  return {
    id,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt,
    cwd,
    path: `${cwd}/${id}.jsonl`,
    leafId: null,
    messageCount: 1,
    totalTokens: 0
  };
}

function mountHistory(
  sessions: ChaptaleSessionListItem[],
  currentWorkspacePath: string,
  scopeFilter = HISTORY_SCOPE_ALL
) {
  const filter = ref(scopeFilter);

  return {
    filter,
    ...useHistorySessions({
      sessions: ref(sessions),
      searchQuery: ref(''),
      scopeFilter: filter,
      sortMode: ref('latest'),
      currentWorkspacePath: ref(currentWorkspacePath)
    })
  };
}

describe('useHistorySessions', () => {
  it('offers every directory that holds sessions, with the current work marked', () => {
    const { scopeOptions } = mountHistory(
      [
        createSession('current', 'E:/Work/Novel'),
        createSession('other', 'E:/Work/Other'),
        createSession('older', 'E:/Work/Other')
      ],
      'E:/Work/Novel'
    );

    expect(scopeOptions.value).toEqual([
      { value: HISTORY_SCOPE_ALL, label: '全部' },
      { value: 'E:/Work/Novel', label: 'E:/Work/Novel · 当前' },
      { value: 'E:/Work/Other', label: 'E:/Work/Other' }
    ]);
  });

  it('orders other directories by most recent use, not by first appearance', () => {
    const { scopeOptions } = mountHistory(
      [
        createSession('stale', 'E:/Work/Stale', '2026-07-01T00:00:00.000Z'),
        createSession('fresh', 'E:/Work/Fresh', '2026-07-20T00:00:00.000Z')
      ],
      ''
    );

    expect(scopeOptions.value.map(option => option.value)).toEqual([
      HISTORY_SCOPE_ALL,
      'E:/Work/Fresh',
      'E:/Work/Stale'
    ]);
  });

  it('filters to one directory and treats sibling paths as different directories', () => {
    const { filter, filteredSessions } = mountHistory(
      [
        createSession('exact', 'E:/Work/Novel'),
        createSession('sibling', 'E:/Work/Novel-2'),
        createSession('other', 'E:/Work/Other')
      ],
      'E:/Work/Novel',
      'E:/Work/Novel-2'
    );

    expect(filteredSessions.value.map(session => session.id)).toEqual(['sibling']);

    filter.value = HISTORY_SCOPE_ALL;
    expect(filteredSessions.value).toHaveLength(3);
  });

  it('falls back to all when the selected directory no longer has sessions', () => {
    const { filteredSessions } = mountHistory(
      [createSession('only', 'E:/Work/Novel')],
      'E:/Work/Novel',
      'E:/Work/Gone'
    );

    expect(filteredSessions.value.map(session => session.id)).toEqual(['only']);
  });

  it('keeps sessions from other directories reachable when no work is open', () => {
    const { filteredSessions, scopeOptions } = mountHistory(
      [createSession('a', 'E:/Work/A'), createSession('b', 'E:/Work/B')],
      ''
    );

    expect(filteredSessions.value).toHaveLength(2);
    expect(scopeOptions.value.every(option => !option.label.includes('当前'))).toBe(true);
  });

  it('counts matches against the full list', () => {
    const { filteredSessions, resultCountText } = mountHistory(
      [createSession('a', 'E:/Work/A'), createSession('b', 'E:/Work/B')],
      'E:/Work/A'
    );

    expect(filteredSessions.value).toHaveLength(2);
    expect(resultCountText.value).toBe('2 个会话');
  });
});
