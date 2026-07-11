import { describe, expect, it } from 'vitest';
import { ref } from 'vue';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';
import { useHistorySessions } from '../useHistorySessions';

function createSession(id: string, scope: 'global' | 'workspace', cwd: string): ChaptaleSessionListItem {
  return {
    id,
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:00.000Z',
    cwd,
    path: `${cwd}/${id}.jsonl`,
    leafId: null,
    messageCount: 1,
    scope,
    totalTokens: 0,
    totalCost: 0
  };
}

describe('useHistorySessions', () => {
  it('limits the workspace scope to the current workspace path', () => {
    const scopeFilter = ref<'all' | 'workspace' | 'global'>('workspace');
    const currentWorkspacePath = ref('C:/work/current/');
    const sessions = ref([
      createSession('current', 'workspace', 'c:\\work\\current'),
      createSession('other', 'workspace', 'C:/work/other'),
      createSession('global', 'global', 'C:/work/current')
    ]);
    const { filteredSessions } = useHistorySessions({
      sessions,
      searchQuery: ref(''),
      scopeFilter,
      sortMode: ref('latest'),
      currentWorkspacePath
    });

    expect(filteredSessions.value.map(session => session.id)).toEqual(['current']);

    scopeFilter.value = 'all';
    expect(filteredSessions.value).toHaveLength(3);
  });
});
