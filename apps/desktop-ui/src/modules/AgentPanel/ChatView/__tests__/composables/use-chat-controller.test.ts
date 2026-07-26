import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, nextTick } from 'vue';

import { useNotificationStore } from '@/features/notifications';
import { useSettingsStore } from '@/stores/settings';

import { useChatController } from '../../composables/useChatController';

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
    slashCommands: {
      list: vi.fn().mockResolvedValue([
        {
          name: 'settings',
          description: '打开 Chaptale 设置',
          source: 'app',
          behavior: 'client-action'
        },
        {
          name: 'skill:review',
          description: '审查正文',
          source: 'skill',
          behavior: 'agent-prompt'
        }
      ])
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
      removeProviderApiKey: vi.fn()
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
        handlers.onEnd({ status: 'completed' });
        return { runId: 'run-1' };
      }),
      steer: vi.fn().mockResolvedValue({ runId: 'run-1' }),
      clearPendingMessages: vi.fn().mockResolvedValue({
        runId: 'run-1',
        queue: { steering: [], followUp: [] }
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
    await vi.waitFor(() => expect(api.slashCommands.list).toHaveBeenCalledWith());
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
      contextFilePaths: [],
      reuseUserEntryId: undefined
    });
    expect(controller.state.messages.map(item => item.message.role)).toEqual(['user', 'assistant']);
    expect(controller.state.messages[1]?.message).toMatchObject({
      role: 'assistant',
      content: [{ type: 'text', text: '最终回复' }]
    });
    expect(controller.state.isReplying).toBe(false);
  });

  it('opens settings locally without sending the slash command to the agent', async () => {
    const api = installDesktopMock();
    const controller = await mountController();
    const settingsStore = useSettingsStore();

    await vi.waitFor(() => expect(controller.state.slashCommands.length).toBeGreaterThan(0));
    controller.state.input = '/settings';
    await controller.handleSend();

    expect(settingsStore.isOpen).toBe(true);
    expect(controller.state.input).toBe('');
    expect(api.agent.stream).not.toHaveBeenCalled();
  });

  it('keeps /settings available when the command list fails to load', async () => {
    const api = installDesktopMock({
      slashCommands: {
        list: vi.fn().mockRejectedValue(new Error('命令服务不可用'))
      }
    });
    const controller = await mountController();
    const settingsStore = useSettingsStore();

    controller.state.input = '/settings';
    await controller.handleSend();

    expect(settingsStore.isOpen).toBe(true);
    expect(api.agent.stream).not.toHaveBeenCalled();
  });

  it('submits known skill commands and rejects unknown slash commands', async () => {
    const api = installDesktopMock();
    const controller = await mountController();
    const notificationStore = useNotificationStore();

    await vi.waitFor(() => expect(controller.state.slashCommands.length).toBeGreaterThan(0));
    controller.state.input = '/skill:review 检查这一段';
    await controller.handleSend();
    expect(controller.state.messages[0]?.message).toMatchObject({
      role: 'user',
      content: '检查这一段',
      skillInvocation: { name: 'review', arguments: '检查这一段' }
    });
    expect(api.agent.stream).toHaveBeenCalledWith('/skill:review 检查这一段', expect.any(Object), 'session-1', {
      branchFromEntryId: undefined,
      contextFilePaths: [],
      reuseUserEntryId: undefined
    });

    vi.clearAllMocks();
    controller.state.input = '/skill:missing';
    await controller.handleSend();

    expect(api.agent.stream).not.toHaveBeenCalled();
    expect(notificationStore.items.at(-1)).toMatchObject({
      kind: 'error',
      title: '未知命令：/skill:missing'
    });
  });

  it('reuses the original skill slash invocation when regenerating', async () => {
    const api = installDesktopMock();
    const controller = await mountController();
    controller.state.messages = [
      {
        id: 'skill-user',
        message: {
          role: 'user',
          content: '检查第一章',
          skillInvocation: { name: 'review', arguments: '检查第一章' }
        }
      },
      {
        id: 'skill-assistant',
        message: { role: 'assistant', content: [{ type: 'text', text: '审查结果' }] }
      }
    ];

    await controller.handleRegenerateAssistantMessage('skill-assistant');

    expect(api.agent.stream).toHaveBeenCalledWith('/skill:review 检查第一章', expect.any(Object), 'session-1', {
      branchFromEntryId: null,
      contextFilePaths: [],
      reuseUserEntryId: undefined
    });
  });

  it('renders a partial tool call without dropping text streamed before it', async () => {
    installDesktopMock({
      agent: {
        selectContextFiles: vi.fn().mockResolvedValue([]),
        inspectContextFiles: vi.fn().mockResolvedValue([]),
        getPathForFile: vi.fn().mockReturnValue(''),
        stream: vi.fn().mockImplementation(async (_query, handlers) => {
          handlers.onMessage({
            role: 'assistant',
            partial: true,
            content: [{ type: 'text', text: '先修改文件。' }]
          });
          handlers.onMessage({
            role: 'assistant',
            partial: true,
            content: [{ type: 'toolCall', id: 'call-1', name: 'edit', arguments: { path: 'src/a.ts' } }]
          });
          handlers.onMessage({
            role: 'toolResult',
            toolCallId: 'call-1',
            toolName: 'edit',
            content: [{ type: 'text', text: 'updated' }]
          });
          return { runId: 'run-tools' };
        }),
        steer: vi.fn(),
        clearPendingMessages: vi.fn(),
        getContextPressure: vi.fn(),
        compactSession: vi.fn(),
        cancel: vi.fn()
      }
    });
    const controller = await mountController();

    controller.state.input = '修改文件';
    await controller.handleSend();

    expect(controller.state.messages.map(item => item.message.role)).toEqual(['user', 'assistant', 'toolResult']);
    expect(controller.state.messages[1]?.message).toMatchObject({
      role: 'assistant',
      content: [
        { type: 'text', text: '先修改文件。' },
        { type: 'toolCall', id: 'call-1', name: 'edit', arguments: { path: 'src/a.ts' } }
      ]
    });
  });

  it('selects context files, sends their paths, and clears the selection after submission', async () => {
    const selectedFile = {
      path: 'C:/novel/outline.md',
      name: 'outline.md',
      size: 2048,
      kind: 'text'
    };
    const selectedImage = {
      path: 'C:/novel/cover.png',
      name: 'cover.png',
      size: 3,
      kind: 'image',
      mimeType: 'image/png',
      previewDataUrl: 'data:image/png;base64,YWJj',
      imageWidth: 100,
      imageHeight: 80
    };
    const api = installDesktopMock();
    api.agent.selectContextFiles.mockResolvedValue([selectedFile, selectedImage]);
    const controller = await mountController();

    await controller.handleAddContextFiles();

    expect(controller.state.contextFiles).toEqual([selectedFile, selectedImage]);

    controller.state.input = '检查大纲';
    await controller.handleSend();

    expect(api.agent.stream).toHaveBeenCalledWith('检查大纲', expect.any(Object), 'session-1', {
      branchFromEntryId: undefined,
      contextFilePaths: ['C:/novel/outline.md', 'C:/novel/cover.png'],
      reuseUserEntryId: undefined
    });
    expect(controller.state.messages[0]?.message).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: '检查大纲' },
        {
          type: 'imageAttachment',
          id: 'selected:C:/novel/cover.png',
          mimeType: 'image/png',
          originalBytes: 3,
          width: 100,
          height: 80,
          thumbnailDataUrl: 'data:image/png;base64,YWJj'
        }
      ],
      contextFiles: [selectedFile]
    });
    expect(controller.state.contextFiles).toEqual([]);
  });

  it('inspects dropped files, keeps supported entries, and reports partial rejection', async () => {
    const supportedFile = new File(['大纲'], 'outline.md', { type: 'text/markdown' });
    const unsupportedFile = new File(['binary'], 'archive.bin', { type: 'application/octet-stream' });
    const inspectedFile = {
      path: 'C:/drop/outline.md',
      name: 'outline.md',
      size: 6,
      kind: 'text'
    };
    const api = installDesktopMock();
    api.agent.getPathForFile.mockImplementation((file: File) => `C:/drop/${file.name}`);
    api.agent.inspectContextFiles.mockResolvedValue([inspectedFile]);
    const controller = await mountController();
    const notificationStore = useNotificationStore();

    await controller.handleDropContextFiles([supportedFile, unsupportedFile]);

    expect(api.agent.inspectContextFiles).toHaveBeenCalledWith(['C:/drop/outline.md', 'C:/drop/archive.bin']);
    expect(controller.state.contextFiles).toEqual([inspectedFile]);
    expect(notificationStore.items.at(-1)).toMatchObject({
      kind: 'info',
      title: '部分文件未添加'
    });
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
    const callsBeforeCancel = api.session.getEntries.mock.calls.length;

    await controller.handleSend();

    expect(api.agent.cancel).toHaveBeenCalledWith('run-cancel');
    expect(controller.state.isReplying).toBe(true);
    expect(controller.state.isCancelling).toBe(true);
    expect(api.session.getEntries).toHaveBeenCalledTimes(callsBeforeCancel);

    streamHandlers.onEnd({ status: 'cancelled' });

    // 只有 Main 的取消终态到达后，Renderer 才收束并回读持久化会话。
    await vi.waitFor(() => expect(api.session.getEntries.mock.calls.length).toBeGreaterThan(callsBeforeCancel));
    expect(controller.state.isReplying).toBe(false);
    expect(controller.state.isCancelling).toBe(false);
  });

  it('sends non-empty input as steer while a run is replying', async () => {
    const api = installDesktopMock({
      agent: {
        stream: vi.fn().mockResolvedValue({ runId: 'run-steer' }),
        steer: vi.fn().mockResolvedValue({ runId: 'run-steer' }),
        clearPendingMessages: vi.fn(),
        cancel: vi.fn()
      }
    } as any);
    const controller = await mountController();

    controller.state.input = '初始问题';
    await controller.handleSend();
    controller.state.contextFiles = [{ path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' }];
    controller.state.input = '聚焦人物动机';
    await controller.handleSend();

    expect(api.agent.steer).toHaveBeenCalledWith('run-steer', '聚焦人物动机', {
      contextFilePaths: ['C:/novel/outline.md']
    });
    expect(api.agent.cancel).not.toHaveBeenCalled();
    expect(controller.state.input).toBe('');
    expect(controller.state.contextFiles).toEqual([]);
    expect(controller.state.messages.at(-1)?.deliveryState).toBe('queued');
  });

  it('keeps the steer draft and attachments when submission fails', async () => {
    const api = installDesktopMock({
      agent: {
        stream: vi.fn().mockResolvedValue({ runId: 'run-steer' }),
        steer: vi.fn().mockRejectedValue(new Error('steer failed')),
        clearPendingMessages: vi.fn(),
        cancel: vi.fn()
      }
    } as any);
    const controller = await mountController();
    const contextFile = { path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' as const };

    controller.state.input = '初始问题';
    await controller.handleSend();
    const messageCountBeforeSteer = controller.state.messages.length;
    controller.state.input = '保留这条调整';
    controller.state.contextFiles = [contextFile];
    await controller.handleSend();

    expect(controller.state.input).toBe('保留这条调整');
    expect(controller.state.contextFiles).toEqual([contextFile]);
    expect(controller.state.messages).toHaveLength(messageCountBeforeSteer);
    expect(useNotificationStore().items.at(-1)).toMatchObject({ title: '发送调整失败' });
    expect(api.agent.cancel).not.toHaveBeenCalled();
  });

  it('restores only the queue tail actually cleared by the SDK', async () => {
    const contextFile = { path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' as const };
    const api = installDesktopMock({
      agent: {
        stream: vi.fn().mockResolvedValue({ runId: 'run-steer' }),
        steer: vi.fn().mockResolvedValue({ runId: 'run-steer' }),
        clearPendingMessages: vi.fn().mockResolvedValue({
          runId: 'run-steer',
          queue: { steering: ['第二条调整'], followUp: [] }
        }),
        cancel: vi.fn()
      }
    } as any);
    const controller = await mountController();

    controller.state.input = '初始问题';
    await controller.handleSend();
    controller.state.input = '第一条调整';
    await controller.handleSend();
    controller.state.contextFiles = [contextFile];
    controller.state.input = '第二条调整';
    await controller.handleSend();
    const queuedMessageId = controller.state.messages.at(-1)!.id;
    controller.state.input = '当前草稿';
    controller.state.contextFiles = [contextFile];

    await controller.handleEditUserMessage(queuedMessageId);

    expect(api.agent.clearPendingMessages).toHaveBeenCalledWith('run-steer');
    expect(controller.state.input).toBe('第二条调整\n\n当前草稿');
    expect(controller.state.contextFiles).toEqual([contextFile]);
    expect(controller.state.messages.some(item => item.id === queuedMessageId)).toBe(false);
    expect(controller.state.messages.some(item => item.deliveryState === 'queued')).toBe(true);
  });

  it('shows an assistant error and notification when stream fails', async () => {
    installDesktopMock({
      agent: {
        stream: vi.fn().mockImplementation(async (_query, handlers) => {
          handlers.onEnd({
            status: 'failed',
            code: 'AGENT_RUN_FAILED',
            message: '模型不可用',
            retryable: false
          });
          return { runId: 'run-error' };
        }),
        cancel: vi.fn()
      }
    } as any);
    const controller = await mountController();
    const notificationStore = useNotificationStore();

    controller.state.input = '会失败';
    await controller.handleSend();

    await vi.waitFor(() =>
      expect(controller.state.messages.at(-1)?.message).toMatchObject({
        role: 'assistant',
        errorMessage: '模型不可用'
      })
    );
    expect(notificationStore.items.at(-1)).toMatchObject({
      kind: 'error',
      title: 'AI 回复失败',
      description: '模型不可用'
    });
  });

  it('reloads persisted messages on error and removes undelivered steer projections', async () => {
    let streamHandlers: any;
    const api = installDesktopMock({
      agent: {
        stream: vi.fn().mockImplementation(async (_query, handlers) => {
          streamHandlers = handlers;
          return { runId: 'run-error' };
        }),
        steer: vi.fn().mockResolvedValue({ runId: 'run-error' }),
        clearPendingMessages: vi.fn(),
        cancel: vi.fn()
      }
    } as any);
    const controller = await mountController();

    controller.state.input = '初始问题';
    await controller.handleSend();
    controller.state.input = '尚未交付的调整';
    await controller.handleSend();
    expect(controller.state.messages.some(item => item.deliveryState === 'queued')).toBe(true);
    const callsBeforeError = api.session.getEntries.mock.calls.length;

    streamHandlers.onEnd({
      status: 'failed',
      code: 'AGENT_RUN_FAILED',
      message: '模型不可用',
      retryable: false
    });

    await vi.waitFor(() => expect(api.session.getEntries.mock.calls.length).toBeGreaterThan(callsBeforeError));
    await vi.waitFor(() =>
      expect(controller.state.messages.at(-1)?.message).toMatchObject({
        role: 'assistant',
        errorMessage: '模型不可用'
      })
    );
    expect(controller.state.messages.some(item => item.message.role === 'user')).toBe(false);
    expect(controller.state.messages.some(item => item.deliveryState)).toBe(false);
  });

  it('ignores stale terminal events from a cancelled run and keeps the new run intact', async () => {
    let firstHandlers: any;
    const api = installDesktopMock({
      agent: {
        stream: vi
          .fn()
          .mockImplementationOnce(async (_query, handlers) => {
            firstHandlers = handlers;
            return { runId: 'run-old' };
          })
          .mockImplementation(async () => ({ runId: 'run-new' })),
        steer: vi.fn(),
        clearPendingMessages: vi.fn(),
        cancel: vi.fn().mockResolvedValue({ runId: 'run-old' })
      }
    } as any);
    const controller = await mountController();
    const notificationStore = useNotificationStore();

    controller.state.input = '旧运行';
    await controller.handleSend();
    controller.state.input = '';
    await controller.handleSend();
    expect(api.agent.cancel).toHaveBeenCalledWith('run-old');
    const reloadsBeforeEnd = api.session.getEntries.mock.calls.length;

    firstHandlers.onEnd({ status: 'cancelled' });
    await vi.waitFor(() => expect(api.session.getEntries.mock.calls.length).toBeGreaterThan(reloadsBeforeEnd));

    controller.state.input = '新运行';
    await controller.handleSend();
    const messageCountAfterNewRun = controller.state.messages.length;

    // 旧 epoch 的重复终态不得收束新运行或污染其视图。
    firstHandlers.onEnd({
      status: 'failed',
      code: 'AGENT_RUN_FAILED',
      message: '旧运行错误',
      retryable: false
    });
    await nextTick();

    expect(notificationStore.items.some(item => item.description === '旧运行错误')).toBe(false);
    expect(controller.state.messages).toHaveLength(messageCountAfterNewRun);
    expect(controller.state.isReplying).toBe(true);
  });

  it('starts the next run only after the error-terminal reload has settled', async () => {
    let firstHandlers: any;
    installDesktopMock({
      agent: {
        stream: vi
          .fn()
          .mockImplementationOnce(async (_query, handlers) => {
            firstHandlers = handlers;
            return { runId: 'run-old' };
          })
          .mockImplementation(async () => ({ runId: 'run-new' })),
        steer: vi.fn(),
        clearPendingMessages: vi.fn(),
        cancel: vi.fn()
      }
    } as any);
    const controller = await mountController();

    controller.state.input = '旧运行';
    await controller.handleSend();
    firstHandlers.onEnd({
      status: 'failed',
      code: 'AGENT_RUN_FAILED',
      message: '模型不可用',
      retryable: false
    });
    controller.state.input = '新运行';
    await controller.handleSend();

    // 新运行必须等终态回载完成后启动，否则旧回载会覆盖新运行的乐观消息。
    const errorIndex = controller.state.messages.findIndex(
      item => item.message.role === 'assistant' && 'errorMessage' in item.message
    );
    const userIndex = controller.state.messages.findIndex(item => item.message.role === 'user');
    expect(errorIndex).toBeGreaterThanOrEqual(0);
    expect(userIndex).toBeGreaterThan(errorIndex);
    expect(controller.state.isReplying).toBe(true);
  });

  it('toggles web search and rolls back the optimistic state when settings update fails', async () => {
    installDesktopMock();
    const controller = await mountController();
    const settingsStore = useSettingsStore();
    vi.spyOn(settingsStore, 'updateWebAccess').mockImplementation(async () => {
      settingsStore.error = '保存失败';
      return false;
    });

    await controller.handleToggleWebSearch();

    expect(controller.state.isEnabledWebSearch).toBe(true);
  });

  it('edits and regenerates text-only messages from the selected user branch', async () => {
    const api = installDesktopMock();
    const controller = await mountController();
    const userMessage = {
      id: 'user-display',
      parentEntryId: 'entry-parent',
      message: { role: 'user' as const, content: '旧内容', timestamp: Date.now() }
    };
    const assistantMessage = {
      id: 'assistant-display',
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: '旧回复' }],
        timestamp: Date.now()
      }
    };
    controller.state.messages = [userMessage, assistantMessage];

    controller.handleEditUserMessage('user-display');
    expect(controller.state.editingMessageId).toBe('user-display');
    controller.handleCancelEdit();

    await controller.handleSaveUserMessage('user-display', '新内容');
    expect(api.agent.stream).toHaveBeenLastCalledWith('新内容', expect.any(Object), 'session-1', {
      branchFromEntryId: 'entry-parent',
      contextFilePaths: [],
      reuseUserEntryId: undefined
    });

    controller.state.messages = [controller.state.messages[0]!, assistantMessage];
    await controller.handleRegenerateAssistantMessage('assistant-display');
    expect(api.agent.stream).toHaveBeenLastCalledWith('新内容', expect.any(Object), 'session-1', {
      branchFromEntryId: 'entry-parent',
      contextFilePaths: [],
      reuseUserEntryId: undefined
    });
  });

  it('reuses the persisted Pi user entry when editing and regenerating attachment messages', async () => {
    const api = installDesktopMock();
    const controller = await mountController();
    const userMessage = {
      id: 'user-display',
      entryId: 'entry-user',
      parentEntryId: 'entry-parent',
      message: {
        role: 'user' as const,
        content: [
          { type: 'text' as const, text: '检查附件' },
          {
            type: 'imageAttachment' as const,
            id: 'image-1',
            mimeType: 'image/png',
            originalBytes: 3,
            width: 100,
            height: 80,
            thumbnailDataUrl: 'data:image/png;base64,YWJj',
            source: { type: 'session-entry' as const, sessionId: 'session-1', entryId: 'entry-user', blockIndex: 1 }
          }
        ],
        contextFiles: [{ path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' as const }]
      }
    };
    const assistantMessage = {
      id: 'assistant-display',
      message: {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: '旧回复' }],
        timestamp: Date.now()
      }
    };
    controller.state.messages = [userMessage, assistantMessage];

    controller.handleEditUserMessage('user-display');
    expect(controller.state.editingMessageId).toBe('user-display');
    await controller.handleSaveUserMessage('user-display', '新内容');
    expect(api.agent.stream).toHaveBeenLastCalledWith('新内容', expect.any(Object), 'session-1', {
      branchFromEntryId: 'entry-parent',
      contextFilePaths: [],
      reuseUserEntryId: 'entry-user'
    });

    controller.state.messages = [controller.state.messages[0]!, assistantMessage];
    await controller.handleRegenerateAssistantMessage('assistant-display');
    expect(api.agent.stream).toHaveBeenLastCalledWith('新内容', expect.any(Object), 'session-1', {
      branchFromEntryId: 'entry-parent',
      contextFilePaths: [],
      reuseUserEntryId: 'entry-user'
    });
  });

  it('waits for attachment messages to receive a persisted entry id before editing', async () => {
    const api = installDesktopMock();
    const controller = await mountController();
    const notificationStore = useNotificationStore();
    controller.state.messages = [
      {
        id: 'user-display',
        message: {
          role: 'user',
          content: '检查附件',
          contextFiles: [{ path: 'C:/novel/outline.md', name: 'outline.md', size: 2048, kind: 'text' }]
        }
      }
    ];

    controller.handleEditUserMessage('user-display');
    await controller.handleSaveUserMessage('user-display', '新内容');

    expect(controller.state.editingMessageId).toBe('');
    expect(api.agent.stream).not.toHaveBeenCalled();
    expect(notificationStore.items.at(-1)).toMatchObject({ title: '附件仍在持久化' });
  });
});
