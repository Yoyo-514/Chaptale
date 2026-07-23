import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';

import { registerPermissionsIpc } from '../ipc';

const ipcMock = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => unknown>()
}));

vi.mock('../../../infra/security/validated-ipc', () => ({
  handleValidatedIpc: vi.fn((channel: string, _validator: unknown, listener: (...args: any[]) => unknown) => {
    ipcMock.listeners.set(channel, listener);
  })
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] }
}));

beforeEach(() => {
  ipcMock.listeners.clear();
  vi.restoreAllMocks();
});

describe('permissions IPC', () => {
  it('lists unique rules per scope while preserving the same rule across scopes', async () => {
    const ruleStore = {
      listPersistentRules: vi.fn().mockResolvedValue({
        workspace: [
          { pattern: 'write', action: 'allow' },
          { pattern: 'write', action: 'allow' }
        ],
        global: [{ pattern: 'write', action: 'allow' }]
      })
    };
    registerPermissionsIpc({ onAsk: vi.fn(), listPending: vi.fn() } as any, ruleStore as any);

    const listener = ipcMock.listeners.get(IPC_CHANNELS.permissions.listRules);
    await expect(listener?.({})).resolves.toEqual([
      { scope: 'workspace', pattern: 'write', action: 'allow' },
      { scope: 'global', pattern: 'write', action: 'allow' }
    ]);
  });

  it('removes the rule from its requested scope and returns the latest list', async () => {
    const ruleStore = {
      removePersistentRule: vi.fn().mockResolvedValue(undefined),
      listPersistentRules: vi.fn().mockResolvedValue({
        workspace: [],
        global: [{ pattern: 'bash(rm *)', action: 'deny' }]
      })
    };
    registerPermissionsIpc({ onAsk: vi.fn(), listPending: vi.fn() } as any, ruleStore as any);
    const listener = ipcMock.listeners.get(IPC_CHANNELS.permissions.removeRule);

    await expect(listener?.({}, { scope: 'workspace', pattern: 'write', action: 'allow' })).resolves.toEqual([
      { scope: 'global', pattern: 'bash(rm *)', action: 'deny' }
    ]);
    expect(ruleStore.removePersistentRule).toHaveBeenCalledWith({ pattern: 'write', action: 'allow' }, 'workspace');
  });
});
