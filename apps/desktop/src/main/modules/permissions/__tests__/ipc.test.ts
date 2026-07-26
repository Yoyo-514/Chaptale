import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';

import type { SessionCtx } from '../../session-ctx/types';
import { registerPermissionsIpc } from '../ipc';

const ipcMock = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => unknown>()
}));

vi.mock('../../../infra/security/validated-ipc', () => ({
  handleValidatedIpc: vi.fn((channel: string, _validator: unknown, listener: (...args: any[]) => unknown) => {
    ipcMock.listeners.set(channel, listener);
  })
}));

const WORKSPACE_A_CTX: SessionCtx = { sessionId: 's1', cwd: '/workspace-a', scope: 'workspace' };

beforeEach(() => {
  ipcMock.listeners.clear();
  vi.restoreAllMocks();
});

describe('permissions IPC', () => {
  it('stores allow-always workspace rules in the pending session workspace', async () => {
    const requestId = 'r1';
    const event = { requestId, sessionId: 's1', toolName: 'write', riskLevel: 'mutating', subject: 'a.md' };
    const broker = {
      onAsk: vi.fn(),
      listPending: vi.fn().mockReturnValue([event]),
      getPending: vi.fn().mockReturnValue({ event, ctx: WORKSPACE_A_CTX }),
      decide: vi.fn().mockReturnValue(event)
    };
    const ruleStore = {
      addRule: vi.fn().mockResolvedValue(undefined)
    };
    const resolveCwd = vi.fn().mockResolvedValue('/workspace-b');
    registerPermissionsIpc(broker as any, ruleStore as any, { broadcast: vi.fn() }, { resolveCwd });

    const listener = ipcMock.listeners.get(IPC_CHANNELS.permissions.decide);
    await expect(
      listener?.({}, { requestId, decision: { outcome: 'allow-always', scope: 'workspace', pattern: 'write(a.md)' } })
    ).resolves.toEqual({ accepted: true });

    expect(ruleStore.addRule).toHaveBeenCalledWith(
      { pattern: 'write(a.md)', action: 'allow' },
      'workspace',
      WORKSPACE_A_CTX
    );
    expect(resolveCwd).not.toHaveBeenCalled();
  });

  it('lists unique rules per scope while preserving the same rule across scopes for the current UI workspace', async () => {
    const ruleStore = {
      listPersistentRules: vi.fn().mockResolvedValue({
        workspace: [
          { pattern: 'write', action: 'allow' },
          { pattern: 'write', action: 'allow' }
        ],
        global: [{ pattern: 'write', action: 'allow' }]
      })
    };
    const resolveCwd = vi.fn().mockResolvedValue('/workspace-b');
    registerPermissionsIpc(
      { onAsk: vi.fn(), listPending: vi.fn() } as any,
      ruleStore as any,
      { broadcast: vi.fn() },
      { resolveCwd }
    );

    const listener = ipcMock.listeners.get(IPC_CHANNELS.permissions.listRules);
    await expect(listener?.({})).resolves.toEqual([
      { scope: 'workspace', pattern: 'write', action: 'allow' },
      { scope: 'global', pattern: 'write', action: 'allow' }
    ]);
    expect(ruleStore.listPersistentRules).toHaveBeenCalledWith('/workspace-b');
  });

  it('removes the rule from its requested scope and returns the latest list for the current UI workspace', async () => {
    const ruleStore = {
      removePersistentRule: vi.fn().mockResolvedValue(undefined),
      listPersistentRules: vi.fn().mockResolvedValue({
        workspace: [],
        global: [{ pattern: 'bash(rm *)', action: 'deny' }]
      })
    };
    const resolveCwd = vi.fn().mockResolvedValue('/workspace-b');
    registerPermissionsIpc(
      { onAsk: vi.fn(), listPending: vi.fn() } as any,
      ruleStore as any,
      { broadcast: vi.fn() },
      { resolveCwd }
    );
    const listener = ipcMock.listeners.get(IPC_CHANNELS.permissions.removeRule);

    await expect(listener?.({}, { scope: 'workspace', pattern: 'write', action: 'allow' })).resolves.toEqual([
      { scope: 'global', pattern: 'bash(rm *)', action: 'deny' }
    ]);
    expect(ruleStore.removePersistentRule).toHaveBeenCalledWith(
      { pattern: 'write', action: 'allow' },
      'workspace',
      '/workspace-b'
    );
  });
});
