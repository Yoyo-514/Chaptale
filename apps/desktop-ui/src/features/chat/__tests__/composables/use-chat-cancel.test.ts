import { mount } from '@vue/test-utils';
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent } from 'vue';

import { useNotificationStore } from '@/features/notifications';

import { useChatController } from '../../composables/useChatController';

function createSession() {
  return {
    id: 'session-1',
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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function installDesktopMock(cancel: ReturnType<typeof vi.fn>) {
  const settings = {
    settings: { version: 1, storage: { mode: 'global' as const }, lastSessionId: 'session-1' },
    webAccess: {
      webSearchEnabled: true,
      provider: 'auto' as const,
      workflow: 'none' as const,
      allowBrowserCookies: false,
      curatorTimeoutSeconds: 20,
      githubClone: { enabled: true, maxRepoSizeMB: 350, cloneTimeoutSeconds: 30 },
      youtube: { enabled: true, preferredModel: 'gemini-3-flash-preview' },
      video: { enabled: true, preferredModel: 'gemini-3-flash-preview', maxSizeMB: 50 },
      ssrf: { allowRanges: [] }
    },
    paths: {}
  };
  let streamHandlers: any;
  const api = {
    session: {
      list: vi.fn().mockResolvedValue([createSession()]),
      create: vi.fn().mockResolvedValue(createSession()),
      getEntries: vi.fn().mockResolvedValue([]),
      setLeaf: vi.fn().mockResolvedValue(undefined)
    },
    settings: {
      getState: vi.fn().mockResolvedValue(settings),
      update: vi.fn().mockResolvedValue(settings),
      updateWebAccess: vi.fn().mockResolvedValue(settings)
    },
    slashCommands: { list: vi.fn().mockResolvedValue([]) },
    models: { list: vi.fn().mockResolvedValue({ providers: [], models: [], defaultModel: undefined }) },
    agent: {
      stream: vi.fn().mockImplementation(async (_query, handlers) => {
        streamHandlers = handlers;
        return { runId: 'run-cancel' };
      }),
      steer: vi.fn().mockResolvedValue({ runId: 'run-cancel' }),
      clearPendingMessages: vi.fn(),
      cancel
    }
  };

  window.chaptaleDesktop = api as any;
  return { api, getStreamHandlers: () => streamHandlers };
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

describe('Agent 取消终态', () => {
  it('取消请求失败时保留活跃运行，仅退出 cancelling 并通知失败', async () => {
    const cancel = vi.fn().mockRejectedValue(new Error('cancel transport failed'));
    const { api } = installDesktopMock(cancel);
    const controller = await mountController();

    controller.state.input = '持续生成';
    await controller.handleSend();
    const reloadsBeforeCancel = api.session.getEntries.mock.calls.length;

    await controller.handleSend();

    expect(controller.state.isReplying).toBe(true);
    expect(controller.state.isCancelling).toBe(false);
    expect(api.session.getEntries).toHaveBeenCalledTimes(reloadsBeforeCancel);
    expect(useNotificationStore().items.at(-1)?.title).toContain('取消失败');

    controller.state.input = '继续调整';
    await controller.handleSend();
    expect(api.agent.steer).toHaveBeenCalledWith('run-cancel', '继续调整', { contextFilePaths: [] });
  });

  it('启动 IPC 尚未返回 runId 时排队取消，并在 runId 可用后发出请求', async () => {
    const run = createDeferred<{ runId: string }>();
    const cancel = vi.fn().mockResolvedValue({ runId: 'run-cancel' });
    const { api } = installDesktopMock(cancel);
    api.agent.stream.mockImplementation(async () => run.promise);
    const controller = await mountController();

    controller.state.input = '持续生成';
    const starting = controller.handleSend();
    await vi.waitFor(() => expect(api.agent.stream).toHaveBeenCalledOnce());

    const cancelling = controller.handleSend();
    run.resolve({ runId: 'run-cancel' });
    await Promise.all([starting, cancelling]);

    expect(cancel).toHaveBeenCalledWith('run-cancel');
    expect(controller.state.isReplying).toBe(true);
    expect(controller.state.isCancelling).toBe(true);
  });

  it('取消请求成功后保持运行，直到 cancelled 终态到达再回载会话', async () => {
    const cancel = vi.fn().mockResolvedValue({ runId: 'run-cancel' });
    const { api, getStreamHandlers } = installDesktopMock(cancel);
    const controller = await mountController();

    controller.state.input = '持续生成';
    await controller.handleSend();
    const reloadsBeforeCancel = api.session.getEntries.mock.calls.length;

    await controller.handleSend();

    expect(controller.state.isReplying).toBe(true);
    expect(controller.state.isCancelling).toBe(true);
    expect(api.session.getEntries).toHaveBeenCalledTimes(reloadsBeforeCancel);

    getStreamHandlers().onEnd({ status: 'cancelled' });

    await vi.waitFor(() => expect(api.session.getEntries.mock.calls.length).toBeGreaterThan(reloadsBeforeCancel));
    expect(controller.state.isReplying).toBe(false);
    expect(controller.state.isCancelling).toBe(false);
  });
});
