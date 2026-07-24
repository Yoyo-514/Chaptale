import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

const electronMock = vi.hoisted(() => ({
  invoke: vi.fn<(channel: string, ...args: unknown[]) => Promise<unknown>>(),
  on: vi.fn(),
  removeListener: vi.fn()
}));

vi.mock('electron', () => ({
  ipcRenderer: electronMock
}));

import { createPermissionsApi } from '../permissions';

beforeEach(() => {
  vi.restoreAllMocks();
  electronMock.invoke.mockReset().mockResolvedValue(undefined);
  electronMock.on.mockReset();
  electronMock.removeListener.mockReset();
});

describe('createPermissionsApi', () => {
  it('invokes pending, decide, list and remove channels with the expected arguments', async () => {
    const api = createPermissionsApi();
    const decision = { requestId: 'permission-1', decision: { outcome: 'allow-once' } } as const;
    const rule = { scope: 'global', pattern: 'write', action: 'allow' } as const;

    await api.getPending('session-1');
    await api.decide(decision);
    await api.listRules();
    await api.removeRule(rule);

    expect(electronMock.invoke.mock.calls).toEqual([
      [IPC_CHANNELS.permissions.pending, 'session-1'],
      [IPC_CHANNELS.permissions.decide, decision],
      [IPC_CHANNELS.permissions.listRules],
      [IPC_CHANNELS.permissions.removeRule, rule]
    ]);
  });

  it('subscribes to ask events and removes the same listener on cleanup', () => {
    const listener = vi.fn();
    const api = createPermissionsApi();

    const cleanup = api.onAsk(listener);
    const handler = electronMock.on.mock.calls[0]?.[1];
    handler?.({}, { requestId: 'permission-1' });
    cleanup();

    expect(listener).toHaveBeenCalledWith({ requestId: 'permission-1' });
    expect(electronMock.removeListener).toHaveBeenCalledWith(IPC_CHANNELS.permissions.ask, handler);
  });
});
