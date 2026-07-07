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
      setLeaf: vi.fn().mockResolvedValue(undefined)
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
