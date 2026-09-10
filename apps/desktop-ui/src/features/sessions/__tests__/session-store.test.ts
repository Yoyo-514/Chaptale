import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSessionStore } from '../store';

const WORKSPACE = 'E:/Stories/Story-1';
const OTHER_WORKSPACE = 'E:/Stories/Story-2';

function createSession(id: string, overrides = {}) {
  return {
    id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    cwd: WORKSPACE,
    path: `${id}.jsonl`,
    leafId: null,
    messageCount: 1,
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
      getStorageDebugInfo: vi.fn().mockResolvedValue({ rootDir: 'root', sessionDir: 'sessions', cwd: 'cwd' }),
      openStorageDir: vi.fn().mockResolvedValue(undefined),
      setLeaf: vi.fn().mockResolvedValue(undefined),
      rename: vi
        .fn()
        .mockResolvedValue({ type: 'session_info', id: 'info-1', parentId: null, timestamp: '', name: '新名字' }),
      exportHtml: vi.fn().mockResolvedValue('C:/exports/会话.html')
    },
    settings: {
      getState: vi.fn().mockResolvedValue({ settings: { version: 1, workspace: {} } }),
      update: vi.fn().mockResolvedValue({ settings: { version: 1, workspace: {} } })
    },
    ...overrides
  };
  window.chaptaleDesktop = api as any;
  return api;
}

/**
 * 会话归作品所有：store 的候选来自绑定的 cwd，所以测试要先绑一个作品。
 * 没有绑定就是"没打开作品"，此时 store 拿不到任何候选，也不该建会话。
 */
function useBoundStore(workspace = WORKSPACE) {
  const store = useSessionStore();
  store.activeCwd = workspace;
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  delete window.chaptaleDesktop;
});

describe('session store', () => {
  it('loads sessions and selects the first session by default', async () => {
    const api = installDesktopApi();
    const store = useBoundStore();

    await store.loadSessions();

    expect(api.session.list).toHaveBeenCalled();
    expect(store.currentSessionId).toBe('session-1');
    expect(store.currentSession?.id).toBe('session-1');
    expect(store.isLoading).toBe(false);
  });

  it('shares one in-flight list request across concurrent loadSessions calls', async () => {
    const api = installDesktopApi();
    api.session.list.mockImplementation(
      () => new Promise(resolve => setTimeout(() => resolve([createSession('session-1')]), 10))
    );
    const store = useBoundStore();

    const [first, second] = await Promise.all([store.loadSessions(), store.loadSessions()]);

    expect(api.session.list).toHaveBeenCalledTimes(1);
    expect(first).toBe(true);
    expect(second).toBe(true);
    expect(store.currentSessionId).toBe('session-1');

    // 在途请求结束后，后续调用必须重新发起请求，而不是复用已完成的 Promise。
    await store.loadSessions();
    expect(api.session.list).toHaveBeenCalledTimes(2);
  });

  it('restores the remembered session of the current work when it still exists', async () => {
    const api = installDesktopApi();
    api.settings.getState.mockResolvedValue({
      settings: { version: 1, workspace: { path: WORKSPACE }, lastSessionId: 'session-2' }
    });
    const store = useBoundStore();

    await store.loadSessions();

    expect(store.currentSessionId).toBe('session-2');
    expect(api.settings.update).not.toHaveBeenCalled();
  });

  it('falls back to the newest session when the remembered session no longer exists', async () => {
    const api = installDesktopApi();
    api.settings.getState.mockResolvedValue({
      settings: { version: 1, workspace: { path: WORKSPACE }, lastSessionId: 'deleted-session' }
    });
    const store = useBoundStore();

    await store.loadSessions();

    expect(store.currentSessionId).toBe('session-1');
    expect(api.settings.update).toHaveBeenCalledWith({ lastSessionId: 'session-1' });
  });

  it('persists explicit session selection', async () => {
    const api = installDesktopApi();
    const store = useBoundStore();
    await store.loadSessions();
    api.settings.update.mockClear();

    await store.selectSession('session-2');

    expect(store.currentSessionId).toBe('session-2');
    expect(api.settings.update).toHaveBeenCalledWith({ lastSessionId: 'session-2' });
  });

  it('creates a fallback session when the work has no session yet', async () => {
    const api = installDesktopApi({
      session: {
        ...installDesktopApi().session,
        list: vi
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([createSession('created')])
      }
    });
    const store = useBoundStore();

    const sessionId = await store.ensureActiveSession();

    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话' });
    expect(sessionId).toBe('created');
  });

  it('does not create a session when loading sessions fails', async () => {
    const api = installDesktopApi({
      session: {
        ...installDesktopApi().session,
        list: vi.fn().mockRejectedValue(new Error('list failed'))
      }
    });
    const store = useBoundStore();

    await expect(store.ensureActiveSession()).rejects.toThrow('list failed');

    expect(api.session.create).not.toHaveBeenCalled();
    expect(store.error).toBe('list failed');
  });

  it('refuses to start a session without a work', async () => {
    const api = installDesktopApi();
    const store = useSessionStore();

    await expect(store.ensureActiveSession()).rejects.toThrow('请先打开作品');

    expect(api.session.list).not.toHaveBeenCalled();
    expect(api.session.create).not.toHaveBeenCalled();
  });

  it('offers no candidates without a work, yet still lists other works for history', async () => {
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([
      createSession('session-a', { cwd: WORKSPACE }),
      createSession('session-b', { cwd: OTHER_WORKSPACE })
    ]);
    const store = useSessionStore();

    await store.loadSessions();

    expect(store.cwdSessions).toEqual([]);
    expect(store.sessions.map(session => session.id)).toEqual(['session-a', 'session-b']);
    expect(store.currentSessionId).toBe('');
  });

  it('keeps a session picked from another work (history) selected across reloads', async () => {
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([
      createSession('session-a', { cwd: WORKSPACE }),
      createSession('session-b', { cwd: OTHER_WORKSPACE })
    ]);
    const store = useBoundStore();
    store.currentSessionId = 'session-b';
    store.selectionRestored = true;

    await store.loadSessions();

    expect(store.currentSessionId).toBe('session-b');
    expect(store.currentSession?.id).toBe('session-b');

    await store.getCurrentEntries();

    expect(api.session.create).not.toHaveBeenCalled();
    expect(api.session.getEntries).toHaveBeenCalledWith('session-b');
    expect(store.currentSessionId).toBe('session-b');
  });

  it('matches current work sessions with normalized cwd paths', () => {
    const store = useSessionStore();
    store.activeCwd = 'E:/Work/Novel/';
    store.sessions = [
      createSession('same-workspace', { cwd: 'e:\\work\\novel' }),
      createSession('other-workspace', { cwd: 'E:/Work/Other' })
    ];

    expect(store.cwdSessions.map(session => session.id)).toEqual(['same-workspace']);
  });

  it('bindCwd keeps the current selection when the cwd is unchanged', async () => {
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([createSession('session-a')]);
    const store = useBoundStore();
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;

    // 打开设置面板 → bindCwd 收到相同 cwd：选择不应被重置，也不应触发列表刷新。
    await store.bindCwd(WORKSPACE);

    expect(store.currentSessionId).toBe('session-a');
    expect(api.session.list).not.toHaveBeenCalled();
  });

  it('bindCwd rebinds to the target work and drops the previous selection', async () => {
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([
      createSession('session-a', { cwd: WORKSPACE }),
      createSession('session-b', { cwd: OTHER_WORKSPACE })
    ]);
    const store = useBoundStore();
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;

    await store.bindCwd(OTHER_WORKSPACE);

    expect(store.activeCwd).toBe(OTHER_WORKSPACE);
    expect(store.currentSessionId).toBe('session-b');
    expect(store.currentSession?.cwd).toBe(OTHER_WORKSPACE);
  });

  it('bindCwd keeps the restored selection on initial binding', async () => {
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([createSession('session-a')]);
    const store = useSessionStore();
    // 启动首次恢复已经选中了别的作品的会话（从历史点进来），activeCwd 尚未绑定。
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;

    await store.bindCwd(WORKSPACE);

    expect(store.currentSessionId).toBe('session-a');
    expect(store.activeCwd).toBe(WORKSPACE);
  });

  it('binding an empty cwd (closed work) clears the selection without touching slots', async () => {
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([createSession('session-a')]);
    const store = useBoundStore();
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;
    api.settings.update.mockClear();

    await store.bindCwd('');

    expect(store.activeCwd).toBe('');
    expect(store.currentSessionId).toBe('');
    expect(store.cwdSessions).toEqual([]);
    expect(api.settings.update).not.toHaveBeenCalled();
  });

  it('clears the selection for a work with no sessions and creates only on demand', async () => {
    const api = installDesktopApi();
    api.session.list.mockResolvedValue([createSession('session-a', { cwd: WORKSPACE })]);
    const store = useBoundStore();
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;
    api.session.list.mockResolvedValueOnce([createSession('session-a')]).mockResolvedValueOnce([]);

    await store.bindCwd(OTHER_WORKSPACE);

    expect(store.currentSessionId).toBe('');
    expect(api.session.create).not.toHaveBeenCalled();

    api.session.create.mockResolvedValue(createSession('created', { cwd: OTHER_WORKSPACE }));
    api.session.list.mockResolvedValue([createSession('created', { cwd: OTHER_WORKSPACE })]);

    const sessionId = await store.ensureActiveSession();

    expect(api.session.create).toHaveBeenCalledWith({ name: '新会话' });
    expect(sessionId).toBe('created');
  });

  it('keeps the requested cwd and clears selection when rebinding fails', async () => {
    const api = installDesktopApi({
      session: {
        ...installDesktopApi().session,
        list: vi.fn().mockRejectedValue(new Error('list failed'))
      }
    });
    const store = useBoundStore();
    store.sessions = [createSession('session-a')];
    store.currentSessionId = 'session-a';

    await expect(store.bindCwd(OTHER_WORKSPACE)).rejects.toThrow('list failed');

    expect(store.activeCwd).toBe(OTHER_WORKSPACE);
    expect(store.currentSessionId).toBe('');
    expect(api.session.create).not.toHaveBeenCalled();
  });

  it('deletes one or many sessions and moves selection away from deleted current session', async () => {
    const api = installDesktopApi();
    const store = useBoundStore();
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

  it('falls back to a session of the current work after deleting a session picked from another work', async () => {
    const api = installDesktopApi();
    const remainingSessions = [
      createSession('session-other', { cwd: OTHER_WORKSPACE }),
      createSession('session-b', { cwd: WORKSPACE })
    ];
    const store = useBoundStore();
    store.sessions = [createSession('session-a', { cwd: OTHER_WORKSPACE }), ...remainingSessions];
    store.currentSessionId = 'session-a';
    store.selectionRestored = true;
    api.session.list.mockResolvedValue(remainingSessions);

    await store.deleteSession('session-a');

    expect(store.currentSessionId).toBe('session-b');
    expect(api.settings.update).not.toHaveBeenCalledWith({ lastSessionId: 'session-other' });
    expect(api.settings.update).toHaveBeenLastCalledWith({ lastSessionId: 'session-b' });
  });

  it('clears the remembered session when the work loses its last session', async () => {
    const api = installDesktopApi();
    const store = useBoundStore();
    store.sessions = [createSession('session-1')];
    store.currentSessionId = 'session-1';
    api.session.list.mockResolvedValue([]);

    await store.deleteSession('session-1');

    expect(store.currentSessionId).toBe('');
    expect(api.settings.update).toHaveBeenLastCalledWith({ lastSessionId: null });
  });

  it('renames a session, ignoring empty names, and reloads the list', async () => {
    const api = installDesktopApi();
    const store = useBoundStore();
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
    const store = useBoundStore();

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
    const store = useBoundStore();

    await store.loadStorageDebugInfo();
    await expect(store.getCurrentEntries()).resolves.toHaveLength(1);
    await store.setCurrentLeaf('entry-1');
    await store.openStorageDir();

    expect(store.storageDebugInfo).toEqual({
      rootDir: 'root',
      sessionDir: 'sessions',
      cwd: 'cwd'
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
    const store = useBoundStore();

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
