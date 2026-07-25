import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '../session';

function createSession(id: string, overrides = {}) {
  return {
    id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    cwd: 'E:/backend-study/Chaptale',
    path: `${id}.jsonl`,
    leafId: null,
    messageCount: 1,
    scope: 'global' as const,
    totalTokens: 0,
    totalCost: 0,
    ...overrides
  };
}

function installDesktopApi(overrides: Record<string, any> = {}) {
  const api = {
    session: {
      list: vi.fn().mockResolvedValue([createSession('session-1'), createSession('session-2')]),
      create: vi.fn().mockResolvedValue(createSession('created')),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
      getEntries: vi.fn().mockResolvedValue([
        {
          type: 'message',
          id: 'entry-1',
          parentId: null,
          timestamp: '2026-07-06T00:00:00.000Z',
          message: { role: 'user', content: 'hi' }
        }
      ]),
      getStorageDebugInfo: vi
        .fn()
        .mockResolvedValue({ rootDir: 'root', sessionDir: 'sessions', cwd: 'cwd', storageMode: 'global' }),
      openStorageDir: vi.fn().mockResolvedValue(undefined),
      setLeaf: vi.fn().mockResolvedValue(undefined),
      rename: vi
        .fn()
        .mockResolvedValue({ type: 'session_info', id: 'info-1', parentId: null, timestamp: '', name: '新名字' }),
      exportHtml: vi.fn().mockResolvedValue('C:/exports/会话.html')
    },
    settings: {
      getState: vi.fn().mockResolvedValue({ settings: { version: 1, storage: { mode: 'global' } } }),
      update: vi.fn().mockResolvedValue({ settings: { version: 1, storage: { mode: 'global' } } })
    },
    ...overrides
  };
  window.chaptaleDesktop = api as any;
  return api;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  delete window.chaptaleDesktop;
});

describe('session store', () => {
  it('loads sessions and selects the first session by default', async () => {
    const api = installDesktopApi();
    const store = useSessionStore();

    await store.loadSessions();

    expect(api.session.list).toHaveBeenCalled();
    expect(store.currentSessionId).toBe('session-1');
    expect(store.currentSession?.id).toBe('session-1');
    expect(store.isLoading).toBe(false);
  });

  it('restores the last opened session when it still exists', async () => {
    const api = installDesktopApi();
    api.settings.getState.mockResolvedValue({
      settings: { version: 1, storage: { mode: 'global' }, lastSessionId: 'session-2' }
    });
    const store = useSessionStore();

    await store.loadSessions();

    expect(store.currentSessionId).toBe('session-2');
    expect(api.settings.update).not.toHaveBeenCalled();
  });

  it('falls back to the newest session when the remembered session no longer exists', async () => {
    const api = installDesktopApi();
    api.settings.getState.mockResolvedValue({
      settings: { version: 1, storage: { mode: 'global' }, lastSessionId: 'deleted-session' }
    });
    const store = useSessionStore();

    await store.loadSessions();

    expect(store.currentSessionId).toBe('session-1');
    expect(api.settings.update).toHaveBeenCalledWith({ lastSessionId: 'session-1' });
  });

  it('persists explicit session selection', async () => {
    const api = installDesktopApi();
    const store = useSessionStore();
    await store.loadSessions();
    api.settings.update.mockClear();

    await store.selectSession('session-2');

    expect(store.currentSessionId).toBe('session-2');
    expect(api.settings.update).toHaveBeenCalledWith({ lastSessionId: 'session-2' });
  });

  it('creates a fallback session when no active session exists', async () => {
    const api = installDesktopApi({
      session: {
        ...installDesktopApi().session,
        list: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([createSession('created')])
      }
    });
    const store = useSessionStore();

    const sessionId = await store.ensureActiveSession();

    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话' });
    expect(sessionId).toBe('created');
  });

  it('does not create a fallback session when loading sessions fails', async () => {
    const api = installDesktopApi({
      session: {
        ...installDesktopApi().session,
        list: vi.fn().mockRejectedValue(new Error('list failed'))
      }
    });
    const store = useSessionStore();

    await expect(store.ensureActiveSession()).rejects.toThrow('list failed');

    expect(api.session.create).not.toHaveBeenCalled();
    expect(store.error).toBe('list failed');
  });

  it('preserves an explicit cross-workspace session across reloads and current entry reads', async () => {
    const workspaceA = 'E:/workspace-a';
    const workspaceB = 'E:/workspace-b';
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([
      createSession('session-a', { cwd: workspaceA, scope: 'workspace' }),
      createSession('session-b', { cwd: workspaceB, scope: 'workspace' })
    ]);
    const store = useSessionStore();
    store.activeCwd = workspaceB;
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;

    await store.loadSessions();

    expect(store.currentSessionId).toBe('session-a');
    expect(store.currentSession?.id).toBe('session-a');
    expect(api.settings.update).not.toHaveBeenCalled();

    await store.getCurrentEntries();

    expect(api.session.create).not.toHaveBeenCalled();
    expect(api.session.getEntries).toHaveBeenCalledWith('session-a');
    expect(store.currentSessionId).toBe('session-a');
  });

  it('keeps an explicitly selected global session when the active cwd points to a sibling workspace', async () => {
    const workspaceA = 'E:/Work/Novel';
    const workspaceB = 'E:/Work/Novel-2';
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([
      createSession('session-global', { cwd: workspaceA, scope: 'global' }),
      createSession('session-b', { cwd: workspaceB, scope: 'workspace' })
    ]);
    const store = useSessionStore();
    store.activeCwd = workspaceB;
    store.currentSessionId = 'session-global';
    store.selectionRestored = true;

    await store.loadSessions();

    expect(store.currentSessionId).toBe('session-global');
    expect(store.currentSession?.id).toBe('session-global');

    await store.getCurrentEntries();

    expect(api.session.getEntries).toHaveBeenCalledWith('session-global');
    expect(store.currentSessionId).toBe('session-global');
  });

  it('matches current workspace sessions with normalized cwd paths', () => {
    const store = useSessionStore();
    store.activeCwd = 'E:/Work/Novel/';
    store.sessions = [
      createSession('same-workspace', { cwd: 'e:\\work\\novel', scope: 'workspace' }),
      createSession('other-workspace', { cwd: 'E:/Work/Other', scope: 'workspace' })
    ];

    expect(store.cwdSessions.map(session => session.id)).toEqual(['same-workspace']);
  });

  it('rebinds the current session to the selected workspace cwd', async () => {
    const workspaceA = 'E:/workspace-a';
    const workspaceB = 'E:/workspace-b';
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([
      createSession('session-a', { cwd: workspaceA, scope: 'workspace' }),
      createSession('session-b', { cwd: workspaceB, scope: 'workspace' })
    ]);
    const store = useSessionStore();
    store.currentSessionId = 'session-a';

    await store.bindCwd(workspaceB);

    expect(store.activeCwd).toBe(workspaceB);
    expect(store.currentSessionId).toBe('session-b');
    expect(store.currentSession?.cwd).toBe(workspaceB);
  });

  it('clears the current session for a workspace with no sessions and creates only on demand', async () => {
    const workspaceA = 'E:/workspace-a';
    const workspaceB = 'E:/workspace-b';
    const api = installDesktopApi();
    api.session.list
      .mockResolvedValueOnce([createSession('session-a', { cwd: workspaceA, scope: 'workspace' })])
      .mockResolvedValueOnce([createSession('session-a', { cwd: workspaceA, scope: 'workspace' })])
      .mockResolvedValueOnce([createSession('created', { cwd: workspaceB, scope: 'workspace' })]);
    api.session.create.mockResolvedValue(createSession('created', { cwd: workspaceB, scope: 'workspace' }));
    const store = useSessionStore();
    store.currentSessionId = 'session-a';

    await store.bindCwd(workspaceB);

    expect(store.currentSessionId).toBe('');
    expect(api.session.create).not.toHaveBeenCalled();

    const sessionId = await store.ensureActiveSession();

    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话' });
    expect(sessionId).toBe('created');
  });

  it('keeps the requested cwd and clears selection when workspace rebind loading fails', async () => {
    const workspaceA = 'E:/workspace-a';
    const workspaceB = 'E:/workspace-b';
    const api = installDesktopApi({
      session: {
        ...installDesktopApi().session,
        list: vi.fn().mockRejectedValue(new Error('list failed'))
      }
    });
    const store = useSessionStore();
    store.sessions = [createSession('session-a', { cwd: workspaceA, scope: 'workspace' })];
    store.activeCwd = workspaceA;
    store.currentSessionId = 'session-a';

    await expect(store.bindCwd(workspaceB)).rejects.toThrow('list failed');

    expect(store.activeCwd).toBe(workspaceB);
    expect(store.currentSessionId).toBe('');
    expect(store.sessions.map(session => session.id)).toEqual(['session-a']);
    expect(api.session.create).not.toHaveBeenCalled();
  });

  it('deletes one or many sessions and moves selection away from deleted current session', async () => {
    const api = installDesktopApi();
    const store = useSessionStore();
    store.sessions = [createSession('session-1'), createSession('session-2'), createSession('session-3')];
    store.currentSessionId = 'session-1';
    api.session.list.mockResolvedValue([createSession('session-2'), createSession('session-3')]);

    await store.deleteSession('session-1');

    expect(api.session.delete).toHaveBeenCalledWith('session-1');
    expect(store.currentSessionId).toBe('session-2');

    store.currentSessionId = 'session-2';
    api.session.list.mockResolvedValue([createSession('session-3')]);
    await store.deleteSessions(['session-2', 'session-2']);

    expect(api.session.deleteMany).toHaveBeenCalledWith(['session-2']);
    expect(store.currentSessionId).toBe('session-3');
  });

  it('falls back to a current-cwd session after deleting an explicit cross-workspace current session', async () => {
    const workspaceA = 'E:/workspace-a';
    const workspaceB = 'E:/workspace-b';
    const workspaceC = 'E:/workspace-c';
    const api = installDesktopApi();
    const remainingSessions = [
      createSession('session-c', { cwd: workspaceC, scope: 'workspace' }),
      createSession('session-b', { cwd: workspaceB, scope: 'workspace' })
    ];
    const store = useSessionStore();
    store.sessions = [createSession('session-a', { cwd: workspaceA, scope: 'workspace' }), ...remainingSessions];
    store.activeCwd = workspaceB;
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;
    api.session.list.mockResolvedValue(remainingSessions);

    await store.deleteSession('session-a');

    expect(store.currentSessionId).toBe('session-b');
    expect(api.settings.update).not.toHaveBeenCalledWith({ lastSessionId: 'session-c' });
    expect(api.settings.update).toHaveBeenLastCalledWith({ lastSessionId: 'session-b' });
  });

  it('falls back to a current-cwd session after deleting an explicit cross-workspace current session in bulk', async () => {
    const workspaceA = 'E:/workspace-a';
    const workspaceB = 'E:/workspace-b';
    const workspaceC = 'E:/workspace-c';
    const api = installDesktopApi();
    const remainingSessions = [
      createSession('session-c', { cwd: workspaceC, scope: 'workspace' }),
      createSession('session-b', { cwd: workspaceB, scope: 'workspace' })
    ];
    const store = useSessionStore();
    store.sessions = [createSession('session-a', { cwd: workspaceA, scope: 'workspace' }), ...remainingSessions];
    store.activeCwd = workspaceB;
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;
    api.session.list.mockResolvedValue(remainingSessions);

    await store.deleteSessions(['session-a', 'session-a']);

    expect(api.session.deleteMany).toHaveBeenCalledWith(['session-a']);
    expect(store.currentSessionId).toBe('session-b');
    expect(api.settings.update).not.toHaveBeenCalledWith({ lastSessionId: 'session-c' });
    expect(api.settings.update).toHaveBeenLastCalledWith({ lastSessionId: 'session-b' });
  });

  it('renames a session, ignoring empty names, and reloads the list', async () => {
    const api = installDesktopApi();
    const store = useSessionStore();
    api.session.list.mockResolvedValue([createSession('session-1', { name: '新名字' }), createSession('session-2')]);

    await store.renameSession('session-1', '  新名字  ');

    expect(api.session.rename).toHaveBeenCalledWith('session-1', '新名字');
    expect(store.sessions[0]?.name).toBe('新名字');

    api.session.rename.mockClear();
    await store.renameSession('session-1', '   ');
    expect(api.session.rename).not.toHaveBeenCalled();

    api.session.rename.mockRejectedValue(new Error('rename failed'));
    await store.renameSession('session-1', '另一个名字');
    expect(store.error).toBe('rename failed');
  });

  it('exports the current branch as html and surfaces failures', async () => {
    const api = installDesktopApi();
    const store = useSessionStore();

    await expect(store.exportSessionHtml('session-1')).resolves.toBe('C:/exports/会话.html');
    expect(api.session.exportHtml).toHaveBeenCalledWith('session-1');

    api.session.exportHtml.mockResolvedValue(null);
    await expect(store.exportSessionHtml('session-1')).resolves.toBeNull();
    expect(store.error).toBe('');

    api.session.exportHtml.mockRejectedValue(new Error('export failed'));
    await expect(store.exportSessionHtml('session-1')).resolves.toBeNull();
    expect(store.error).toBe('export failed');
  });

  it('reads storage debug info, entries, and updates the current leaf', async () => {
    const api = installDesktopApi();
    const store = useSessionStore();

    await store.loadStorageDebugInfo();
    await expect(store.getCurrentEntries()).resolves.toHaveLength(1);
    await store.setCurrentLeaf('entry-1');
    await store.openStorageDir();

    expect(store.storageDebugInfo).toEqual({
      rootDir: 'root',
      sessionDir: 'sessions',
      cwd: 'cwd',
      storageMode: 'global'
    });
    expect(api.session.setLeaf).toHaveBeenCalledWith('session-1', 'entry-1');
    expect(api.session.openStorageDir).toHaveBeenCalled();
  });

  it('stores user-readable errors when desktop calls fail', async () => {
    installDesktopApi({
      session: {
        ...installDesktopApi().session,
        list: vi.fn().mockRejectedValue(new Error("Error invoking remote method 'session:list': Error: boom")),
        delete: vi.fn().mockRejectedValue(new Error('delete failed')),
        getStorageDebugInfo: vi.fn().mockRejectedValue(new Error('debug failed')),
        openStorageDir: vi.fn().mockRejectedValue(new Error('open failed'))
      }
    });
    const store = useSessionStore();

    await store.loadSessions();
    expect(store.error).toBe('boom');

    await store.deleteSession('missing');
    expect(store.error).toBe('delete failed');

    await store.loadStorageDebugInfo();
    expect(store.error).toBe('debug failed');

    await store.openStorageDir();
    expect(store.error).toBe('open failed');
  });
});
