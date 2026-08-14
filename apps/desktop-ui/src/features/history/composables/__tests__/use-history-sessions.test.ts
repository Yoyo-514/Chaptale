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
    totalTokens: 0
  };
}

describe('useHistorySessions', () => {
  it('limits the workspace scope to the current workspace path', () => {
    const scopeFilter = ref<'all' | 'workspace' | 'global'>('workspace');
    const currentWorkspacePath = ref('E:/Work/Novel/');
    const sessions = ref([
      createSession('current', 'workspace', 'e:\\work\\novel'),
      createSession('other', 'workspace', 'E:/Work/Other'),
      createSession('global', 'global', 'E:/Work/Novel')
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

  it('treats sibling workspace paths as different workspaces instead of prefix matches', () => {
    const scopeFilter = ref<'all' | 'workspace' | 'global'>('workspace');
    const currentWorkspacePath = ref('E:/Work/Novel');
    const sessions = ref([
      createSession('exact', 'workspace', 'E:/Work/Novel'),
      createSession('sibling', 'workspace', 'E:/Work/Novel-2'),
      createSession('global', 'global', 'E:/Work/Novel')
    ]);
    const { filteredSessions } = useHistorySessions({
      sessions,
      searchQuery: ref(''),
      scopeFilter,
      sortMode: ref('latest'),
      currentWorkspacePath
    });

    expect(filteredSessions.value.map(session => session.id)).toEqual(['exact']);
  });
});
