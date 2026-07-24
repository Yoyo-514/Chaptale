import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentDoneEvent, AgentErrorEvent, AgentMessageEvent, AgentRunResult } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';
import type { ChatMessage } from '@chaptale/shared';

const electronMock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  const listeners = new Map<string, Set<Listener>>();
  const invoke = vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>();

  return {
    invoke,
    on: vi.fn((channel: string, listener: Listener) => {
      const channelListeners = listeners.get(channel) ?? new Set<Listener>();
      channelListeners.add(listener);
      listeners.set(channel, channelListeners);
    }),
    removeListener: vi.fn((channel: string, listener: Listener) => {
      listeners.get(channel)?.delete(listener);
    }),
    emit(channel: string, payload: unknown) {
      for (const listener of listeners.get(channel) ?? []) {
        listener({}, payload);
      }
    },
    listenerCount(channel: string) {
      return listeners.get(channel)?.size ?? 0;
    },
    reset() {
      listeners.clear();
      invoke.mockReset();
    }
  };
});

vi.mock('electron', () => ({
  ipcRenderer: {
    invoke: electronMock.invoke,
    on: electronMock.on,
    removeListener: electronMock.removeListener
  },
  webUtils: {
    getPathForFile: vi.fn()
  }
}));

import { createAgentApi } from '../agent';

const OTHER_RUN_ID = '00000000-0000-4000-8000-000000000000';
const agentChannels = [IPC_CHANNELS.agent.message, IPC_CHANNELS.agent.done, IPC_CHANNELS.agent.error] as const;

function expectNoAgentListeners(): void {
  for (const channel of agentChannels) {
    expect(electronMock.listenerCount(channel)).toBe(0);
  }
}

beforeEach(() => {
  vi.restoreAllMocks();
  electronMock.reset();
  electronMock.invoke.mockResolvedValue(undefined);
});

describe('createAgentApi', () => {
  it('只转发相同 runId 的 message，并忽略其他 runId', async () => {
    const onMessage = vi.fn();
    const api = createAgentApi();
    const message: ChatMessage = { role: 'user', content: 'same run' };

    const { runId } = await api.stream('query', { onMessage });
    electronMock.emit(IPC_CHANNELS.agent.message, {
      runId: OTHER_RUN_ID,
      message: { role: 'user', content: 'other run' }
    } satisfies AgentMessageEvent);
    electronMock.emit(IPC_CHANNELS.agent.message, { runId, message } satisfies AgentMessageEvent);

    expect(onMessage).toHaveBeenCalledOnce();
    expect(onMessage).toHaveBeenCalledWith(message);
  });

  it('只转发相同 runId 的 done，并在转发后清理自己的三个监听器', async () => {
    const onDone = vi.fn();
    const api = createAgentApi();

    const { runId } = await api.stream('query', { onMessage: vi.fn(), onDone });
    electronMock.emit(IPC_CHANNELS.agent.done, { runId: OTHER_RUN_ID } satisfies AgentDoneEvent);

    expect(onDone).not.toHaveBeenCalled();
    for (const channel of agentChannels) {
      expect(electronMock.listenerCount(channel)).toBe(1);
    }

    electronMock.emit(IPC_CHANNELS.agent.done, { runId } satisfies AgentDoneEvent);

    expect(onDone).toHaveBeenCalledOnce();
    expectNoAgentListeners();
  });

  it('只转发相同 runId 的 error，并在转发后清理自己的三个监听器', async () => {
    const onError = vi.fn();
    const api = createAgentApi();

    const { runId } = await api.stream('query', { onMessage: vi.fn(), onError });
    electronMock.emit(IPC_CHANNELS.agent.error, {
      runId: OTHER_RUN_ID,
      message: 'other failure'
    } satisfies AgentErrorEvent);

    expect(onError).not.toHaveBeenCalled();
    for (const channel of agentChannels) {
      expect(electronMock.listenerCount(channel)).toBe(1);
    }

    electronMock.emit(IPC_CHANNELS.agent.error, {
      runId,
      message: 'run failure'
    } satisfies AgentErrorEvent);

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('run failure');
    expectNoAgentListeners();
  });

  it('start invoke 失败时清理自己的三个监听器并保留原始拒绝', async () => {
    const startFailure = new Error('start failed');
    electronMock.invoke.mockRejectedValueOnce(startFailure);
    const api = createAgentApi();

    await expect(api.stream('query', { onMessage: vi.fn() })).rejects.toBe(startFailure);

    expectNoAgentListeners();
  });

  it('并发 run 完成时只清理自身监听器，不影响另一个 run', async () => {
    const onDoneA = vi.fn();
    const onDoneB = vi.fn();
    const onMessageB = vi.fn();
    const api = createAgentApi();

    const [runA, runB] = await Promise.all([
      api.stream('query a', { onMessage: vi.fn(), onDone: onDoneA }),
      api.stream('query b', { onMessage: onMessageB, onDone: onDoneB })
    ]);

    electronMock.emit(IPC_CHANNELS.agent.done, { runId: runA.runId } satisfies AgentDoneEvent);

    expect(onDoneA).toHaveBeenCalledOnce();
    expect(onDoneB).not.toHaveBeenCalled();
    for (const channel of agentChannels) {
      expect(electronMock.listenerCount(channel)).toBe(1);
    }

    const message: ChatMessage = { role: 'user', content: 'run b remains active' };
    electronMock.emit(IPC_CHANNELS.agent.message, { runId: runB.runId, message } satisfies AgentMessageEvent);

    expect(onMessageB).toHaveBeenCalledWith(message);
  });

  it('steer 转发 runId、query 与上下文文件路径', async () => {
    const result: AgentRunResult = { runId: OTHER_RUN_ID };
    electronMock.invoke.mockResolvedValueOnce(result);
    const api = createAgentApi();

    await expect(
      api.steer(OTHER_RUN_ID, '调整人物动机', { contextFilePaths: ['C:/novel/character.md'] })
    ).resolves.toEqual(result);
    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.agent.steer, {
      runId: OTHER_RUN_ID,
      query: '调整人物动机',
      contextFilePaths: ['C:/novel/character.md']
    });
  });

  it('clearPendingMessages 保持主进程返回的队列结果', async () => {
    const result = {
      runId: OTHER_RUN_ID,
      queue: { steering: ['调整人物动机'], followUp: [] }
    };
    electronMock.invoke.mockResolvedValueOnce(result);
    const api = createAgentApi();

    await expect(api.clearPendingMessages(OTHER_RUN_ID)).resolves.toEqual(result);
    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.agent.clearPendingMessages, {
      runId: OTHER_RUN_ID
    });
  });

  it('cancel 保持主进程返回的 AgentRunResult', async () => {
    const result: AgentRunResult = { runId: OTHER_RUN_ID };
    electronMock.invoke.mockResolvedValueOnce(result);
    const api = createAgentApi();

    await expect(api.cancel(OTHER_RUN_ID)).resolves.toEqual(result);
    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.agent.cancel, OTHER_RUN_ID);
  });
});
