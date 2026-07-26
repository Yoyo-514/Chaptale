import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TodosUpdatedEventValidator } from '@chaptale/ipc-contract';

const electronMock = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  const listeners = new Map<string, Set<Listener>>();

  return {
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
    reset() {
      listeners.clear();
    }
  };
});

vi.mock('electron', () => ({
  ipcRenderer: {
    on: electronMock.on,
    removeListener: electronMock.removeListener
  }
}));

import { onValidatedEvent } from '../validated-event';

const CHANNEL = 'test:channel';

beforeEach(() => {
  vi.restoreAllMocks();
  electronMock.reset();
  electronMock.on.mockClear();
  electronMock.removeListener.mockClear();
});

describe('onValidatedEvent', () => {
  it('合法 payload 传递给 listener', () => {
    const listener = vi.fn();
    onValidatedEvent(CHANNEL, TodosUpdatedEventValidator, listener);

    const payload = {
      sessionId: 'session-1',
      items: [{ id: 't1', content: '写第三章大纲', status: 'pending' }]
    };
    electronMock.emit(CHANNEL, payload);

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(payload);
  });

  it('非法 payload 被丢弃且 console.error', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const listener = vi.fn();
    onValidatedEvent(CHANNEL, TodosUpdatedEventValidator, listener);

    electronMock.emit(CHANNEL, { bogus: 1 });

    expect(listener).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledOnce();
  });

  it('返回的清理函数以同一 handler 移除监听', () => {
    const listener = vi.fn();
    const cleanup = onValidatedEvent(CHANNEL, TodosUpdatedEventValidator, listener);

    const handler = electronMock.on.mock.calls[0]?.[1];
    cleanup();

    expect(electronMock.removeListener).toHaveBeenCalledWith(CHANNEL, handler);

    electronMock.emit(CHANNEL, {
      sessionId: 'session-1',
      items: []
    });
    expect(listener).not.toHaveBeenCalled();
  });
});
