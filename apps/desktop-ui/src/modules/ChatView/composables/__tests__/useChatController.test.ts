import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { defineComponent, nextTick } from 'vue';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useNotificationStore } from '../../../../stores/notification';
import { useSettingsStore } from '../../../../stores/settings';
import { useChatController } from '../useChatController';

function createSettingsState(webSearchEnabled = true) {
  return {
    settings: {
      version: 1,
      storage: { mode: 'global' }
    },
    webAccess: {
      webSearchEnabled,
      provider: 'auto',
      workflow: 'none',
      allowBrowserCookies: false,
      curatorTimeoutSeconds: 20,
      githubClone: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      youtube: { enabled: true, preferredModel: 'gemini-3-flash-preview' },
      video: { enabled: true, preferredModel: 'gemini-3-flash-preview', maxSizeMB: 50 },
      ssrf: { allowRanges: [] }
    },
    paths: {
      rootDir: 'C:/Users/Test/.chaptale',
      agentDir: 'C:/Users/Test/.chaptale/agent',
      settingsPath: 'C:/Users/Test/.chaptale/settings.json',
      piSettingsPath: 'C:/Users/Test/.chaptale/agent/settings.json',
      piModelsPath: 'C:/Users/Test/.chaptale/agent/models.json',
      piAuthPath: 'C:/Users/Test/.chaptale/agent/auth.json',
      piWebAccessConfigPath: 'C:/Users/Test/.chaptale/agent/web-search.json',
      sessionsRootDir: 'C:/Users/Test/.chaptale/agent/sessions',
      effectiveSessionDir: 'C:/Users/Test/.chaptale/agent/sessions/global'
    }
  };
}

function createSession(id = 'session-1') {
  return {
    id,
    createdAt: '2026-07-06T00:00:00.000Z',
    updatedAt: '2026-07-06T00:00:00.000Z',
    cwd: 'E:/backend-study/Chaptale',
    path: 'session.jsonl',
    leafId: null,
    messageCount: 1,
    lastMessagePreview: '最近消息',
    scope: 'global' as const,
    totalTokens: 0,
    totalCost: 0
  };
}

function installDesktopMock(overrides: Partial<NonNullable<typeof window.chaptaleDesktop>> = {}) {
  const state = createSettingsState(true);
  const api = {
    session: {
      list: vi.fn().mockResolvedValue([createSession('session-1'), createSession('session-2')]),
      create: vi.fn().mockResolvedValue(createSession('session-1')),
      delete: vi.fn().mockResolvedValue(undefined),
      deleteMany: vi.fn().mockResolvedValue(undefined),
      getEntries: vi.fn().mockResolvedValue([]),
      getStorageDebugInfo: vi.fn().mockResolvedValue({
        rootDir: 'C:/Users/Test/.chaptale',
        sessionDir: 'C:/Users/Test/.chaptale/agent/sessions/global',
        cwd: 'E:/backend-study/Chaptale',
        storageMode: 'global'
      }),
      openStorageDir: vi.fn().mockResolvedValue(undefined),
      setLeaf: vi.fn().mockResolvedValue(undefined)
    },
    settings: {
      getState: vi.fn().mockResolvedValue(state),
      update: vi.fn().mockResolvedValue(state),
      updateWebAccess: vi.fn().mockImplementation(async payload => {
        if (typeof payload.webSearchEnabled === 'boolean') {
          state.webAccess.webSearchEnabled = payload.webSearchEnabled;
        }
        return state;
      }),
      selectWorkspaceDir: vi.fn().mockResolvedValue({ canceled: true }),
      openConfigDir: vi.fn().mockResolvedValue(undefined)
    },
    models: {
      list: vi.fn().mockResolvedValue({ providers: [], models: [], defaultModel: undefined }),
      setDefault: vi.fn(),
      setProviderApiKey: vi.fn(),
      fetchCustomProviderModels: vi.fn(),
      addCustomProvider: vi.fn(),
      addCustomModel: vi.fn(),
      setCustomProviderApiKey: vi.fn(),
      removeCustomProviderApiKey: vi.fn(),
      updateCustomModelInput: vi.fn(),
      removeCustomModel: vi.fn(),
      removeProviderAuth: vi.fn()
    },
    agent: {
      selectContextFiles: vi.fn().mockResolvedValue([]),
      inspectContextFiles: vi.fn().mockResolvedValue([]),
      getPathForFile: vi.fn().mockReturnValue(''),
      stream: vi.fn().mockImplementation(async (_query, handlers) => {
        handlers.onMessage({
          role: 'assistant',
          partial: true,
          content: [{ type: 'text', text: '草稿' }],
          timestamp: Date.now()
        });
        handlers.onMessage({ role: 'assistant', content: [{ type: 'text', text: '最终回复' }], timestamp: Date.now() });
        handlers.onDone();
        return { runId: 'run-1' };
      }),
      cancel: vi.fn().mockResolvedValue({ runId: 'run-1' })
    },
    ...overrides
  } as unknown as NonNullable<typeof window.chaptaleDesktop>;

  window.chaptaleDesktop = api;
  return api as any;
}

async function mountController() {
  let controller!: ReturnType<typeof useChatController>;
  mount(
    defineComponent({
      setup() {
        controller = useChatController();
        return () => null;
      }
    })
  );
  await vi.waitFor(() => expect(controller.state.isLoadingMessages).toBe(false));
  return controller;
}

beforeEach(() => {
  setActivePinia(createPinia());
  delete window.chaptaleDesktop;
  vi.restoreAllMocks();
});

describe('useChatController', () => {
  it('loads session messages and settings on mount', async () => {
    const api = installDesktopMock();

    const controller = await mountController();

    expect(api.session.list).toHaveBeenCalled();
    expect(api.session.getEntries).toHaveBeenCalledWith('session-1');
    expect(api.settings.getState).toHaveBeenCalled();
    expect(controller.state.isEnabledWebSearch).toBe(true);
    expect(controller.recentSessions.value).toHaveLength(1);
  });

  it('sends the prompt, appends optimistic user message, and renders the assistant answer', async () => {
    const api = installDesktopMock();
    const controller = await mountController();

    controller.state.input = '写一个开场';
    await controller.handleSend();
    await nextTick();

    expect(api.agent.stream).toHaveBeenCalledWith('写一个开场', expect.any(Object), 'session-1', {
      branchFromEntryId: undefined,
      contextFilePaths: []
    });
    expect(controller.state.messages.map(item => item.message.role)).toEqual(['user', 'assistant']);
    expect(controller.state.messages[1]?.message).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: '最终回复' }]
    });
    expect(controller.state.isReplying).toBe(false);
  });

  it('cancels the active run when send is clicked while replying', async () => {
    let streamHandlers: any;
    const api = installDesktopMock({
      agent: {
        stream: vi.fn().mockImplementation(async (_query, handlers) => {
          streamHandlers = handlers;
          return { runId: 'run-cancel' };
        }),
        cancel: vi.fn().mockResolvedValue({ runId: 'run-cancel' })
      }
    } as any);
    const controller = await mountController();

    controller.state.input = '持续生成';
    await controller.handleSend();
    expect(controller.state.isReplying).toBe(true);

    await controller.handleSend();

    expect(api.agent.cancel).toHaveBeenCalledWith('run-cancel');
    expect(controller.state.isReplying).toBe(false);
    expect(streamHandlers).toBeDefined();
  });

  it('shows an assistant error and notification when stream fails', async () => {
    installDesktopMock({
      agent: {
        stream: vi.fn().mockImplementation(async (_query, handlers) => {
          handlers.onError('模型不可用');
          return { runId: 'run-error' };
        }),
        cancel: vi.fn()
      }
    } as any);
    const controller = await mountController();
    const notificationStore = useNotificationStore();

    controller.state.input = '会失败';
    await controller.handleSend();

    expect(controller.state.messages.at(-1)?.message).toMatchObject({ role: 'assistant', errorMessage: '模型不可用' });
    expect(notificationStore.items.at(-1)).toMatchObject({
      kind: 'error',
      title: 'AI 回复失败',
      description: '模型不可用'
    });
  });

  it('toggles web search and rolls back the optimistic state when settings update fails', async () => {
    installDesktopMock();
    const controller = await mountController();
    const settingsStore = useSettingsStore();
    vi.spyOn(settingsStore, 'updateWebAccess').mockImplementation(async () => {
      settingsStore.error = '保存失败';
    });

    await controller.handleToggleWebSearch();

    expect(controller.state.isEnabledWebSearch).toBe(true);
  });

  it('edits and regenerates from the selected user branch', async () => {
    const api = installDesktopMock();
    const controller = await mountController();
    controller.state.messages = [
      {
        id: 'user-display',
        parentEntryId: 'entry-user',
        message: { role: 'user', content: '旧内容', timestamp: Date.now() }
      },
      {
        id: 'assistant-display',
        message: { role: 'assistant', content: [{ type: 'text', text: '旧回复' }], timestamp: Date.now() }
      }
    ];

    controller.handleEditUserMessage('user-display');
    expect(controller.state.editingMessageId).toBe('user-display');
    controller.handleCancelEdit();
    expect(controller.state.editingMessageId).toBe('');

    await controller.handleSaveUserMessage('user-display', '新内容');
    expect(api.agent.stream).toHaveBeenLastCalledWith('新内容', expect.any(Object), 'session-1', {
      branchFromEntryId: 'entry-user',
      contextFilePaths: []
    });
    expect(controller.state.messages[0]?.branch).toMatchObject({ current: 2, total: 2 });

    await controller.handleRegenerateAssistantMessage('assistant-display');
    expect(api.agent.stream).toHaveBeenLastCalledWith('新内容', expect.any(Object), 'session-1', {
      branchFromEntryId: 'entry-user',
      contextFilePaths: []
    });
  });
});
