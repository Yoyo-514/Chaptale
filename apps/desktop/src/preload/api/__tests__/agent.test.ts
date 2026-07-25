import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AgentEndEvent, AgentMessageEvent, AgentRunResult, RunEnd } from '@chaptale/ipc-contract';
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
const agentChannels = [IPC_CHANNELS.agent.message, IPC_CHANNELS.agent.end] as const;

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

  it.each<RunEnd>([
    { status: 'completed' },
    { status: 'cancelled' },
    { status: 'failed', code: 'AGENT_RUN_FAILED', message: 'run failure', retryable: false }
  ])('只转发相同 runId 的 $status 终态，并清理自己的 message/end 监听器', async end => {
    const onEnd = vi.fn();
    const api = createAgentApi();

    const { runId } = await api.stream('query', { onMessage: vi.fn(), onEnd });
    electronMock.emit(IPC_CHANNELS.agent.end, { runId: OTHER_RUN_ID, end } satisfies AgentEndEvent);

    expect(onEnd).not.toHaveBeenCalled();
    for (const channel of agentChannels) {
      expect(electronMock.listenerCount(channel)).toBe(1);
    }

    electronMock.emit(IPC_CHANNELS.agent.end, { runId, end } satisfies AgentEndEvent);

    expect(onEnd).toHaveBeenCalledOnce();
    expect(onEnd).toHaveBeenCalledWith(end);
    expectNoAgentListeners();
  });

  it('start invoke 失败时清理自己的两个监听器并保留原始拒绝', async () => {
    const startFailure = new Error('start failed');
    electronMock.invoke.mockRejectedValueOnce(startFailure);
    const api = createAgentApi();

    await expect(api.stream('query', { onMessage: vi.fn() })).rejects.toBe(startFailure);

    expectNoAgentListeners();
  });

  it('并发 run 完成时只清理自身监听器，不影响另一个 run', async () => {
    const onEndA = vi.fn();
    const onEndB = vi.fn();
    const onMessageB = vi.fn();
    const api = createAgentApi();

    const [runA, runB] = await Promise.all([
      api.stream('query a', { onMessage: vi.fn(), onEnd: onEndA }),
      api.stream('query b', { onMessage: onMessageB, onEnd: onEndB })
    ]);

    electronMock.emit(IPC_CHANNELS.agent.end, {
      runId: runA.runId,
      end: { status: 'completed' }
    } satisfies AgentEndEvent);

    expect(onEndA).toHaveBeenCalledOnce();
    expect(onEndB).not.toHaveBeenCalled();
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

  it('getContextPressure 按 sessionId 查询上下文水位', async () => {
    const result = {
      tokens: 72_000,
      contextWindow: 100_000,
      percent: 72,
      thresholdPercent: 70,
      shouldPrompt: true
    };
    electronMock.invoke.mockResolvedValueOnce(result);
    const api = createAgentApi();

    await expect(api.getContextPressure('session-1')).resolves.toEqual(result);
    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.agent.getContextPressure, 'session-1');
  });

  it('compactSession 按 sessionId 执行作者确认后的压缩', async () => {
    const result = {
      sessionId: 'session-1',
      tokensBefore: 72_000,
      estimatedTokensAfter: 18_000,
      summaryRef: '.chaptale/memory/summaries/compactions/summary.md'
    };
    electronMock.invoke.mockResolvedValueOnce(result);
    const api = createAgentApi();

    await expect(api.compactSession('session-1')).resolves.toEqual(result);
    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.agent.compactSession, 'session-1');
  });

  it('cancel 保持主进程返回的 AgentRunResult', async () => {
    const result: AgentRunResult = { runId: OTHER_RUN_ID };
    electronMock.invoke.mockResolvedValueOnce(result);
    const api = createAgentApi();

    await expect(api.cancel(OTHER_RUN_ID)).resolves.toEqual(result);
    expect(electronMock.invoke).toHaveBeenCalledWith(IPC_CHANNELS.agent.cancel, OTHER_RUN_ID);
  });
});
