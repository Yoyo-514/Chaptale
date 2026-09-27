import { mkdtemp, realpath, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';

import type { SessionCtx } from '../../../core/session-ctx/types';
import { registerPermissionsIpc } from '../ipc';

const ipcMock = vi.hoisted(() => ({
  listeners: new Map<string, (...args: any[]) => unknown>()
}));

vi.mock('../../../infra/security/validated-ipc', () => ({
  handleValidatedIpc: vi.fn((channel: string, _validator: unknown, listener: (...args: any[]) => unknown) => {
    ipcMock.listeners.set(channel, listener);
  })
}));

const WORKSPACE_A_CTX: SessionCtx = { sessionId: 's1', cwd: '/workspace-a' };
const tempDirs: string[] = [];

function createUi(picked?: string) {
  return { broadcast: vi.fn(), resolveOwner: vi.fn(() => 'owner'), pickDirectory: vi.fn(async () => picked) };
}

/** 对待决请求 r1 提交「始终允许」。 */
function decideAlways(scope: string, pattern: string) {
  return ipcMock.listeners.get(IPC_CHANNELS.permissions.decide)?.(
    {},
    { requestId: 'r1', decision: { outcome: 'allow-always', scope, pattern } }
  );
}

beforeEach(() => {
  ipcMock.listeners.clear();
  vi.restoreAllMocks();
});

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
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
    registerPermissionsIpc(broker as any, ruleStore as any, createUi(), { resolveCwd, protectedRoots: [] });

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
    registerPermissionsIpc({ onAsk: vi.fn(), listPending: vi.fn() } as any, ruleStore as any, createUi(), {
      resolveCwd,
      protectedRoots: []
    });

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
    registerPermissionsIpc({ onAsk: vi.fn(), listPending: vi.fn() } as any, ruleStore as any, createUi(), {
      resolveCwd,
      protectedRoots: []
    });
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

  it('refuses to persist external grants at workspace scope or without a directory, but accepts session grants', async () => {
    const event = {
      requestId: 'r1',
      sessionId: 's1',
      toolName: 'external_read',
      riskLevel: 'sensitive',
      subject: 'E:/资料/a.md'
    };
    const broker = {
      onAsk: vi.fn(),
      getPending: vi.fn().mockReturnValue({ event, ctx: WORKSPACE_A_CTX }),
      decide: vi.fn().mockReturnValue(event)
    };
    const ruleStore = { addRule: vi.fn().mockResolvedValue(undefined) };
    registerPermissionsIpc(broker as any, ruleStore as any, createUi(), { resolveCwd: vi.fn(), protectedRoots: [] });

    await expect(decideAlways('workspace', 'external_read(E:/资料/*)')).rejects.toThrow(/作品级/);
    await expect(decideAlways('global', 'external_read')).rejects.toThrow(/具体目录/);
    await expect(decideAlways('global', 'external_read(*)')).rejects.toThrow(/具体目录/);
    expect(ruleStore.addRule).not.toHaveBeenCalled();
    expect(broker.decide).not.toHaveBeenCalled();

    await expect(decideAlways('session', 'external_read(E:/资料/*)')).resolves.toEqual({ accepted: true });
    expect(ruleStore.addRule).toHaveBeenCalledWith(
      { pattern: 'external_read(E:/资料/*)', action: 'allow' },
      'session',
      WORKSPACE_A_CTX
    );
  });

  it('refuses to smuggle an external grant through an ordinary request', async () => {
    const event = { requestId: 'r1', sessionId: 's1', toolName: 'write', riskLevel: 'mutating', subject: '草稿/a.md' };
    const broker = {
      onAsk: vi.fn(),
      getPending: vi.fn().mockReturnValue({ event, ctx: WORKSPACE_A_CTX }),
      decide: vi.fn().mockReturnValue(event)
    };
    const ruleStore = { addRule: vi.fn().mockResolvedValue(undefined) };
    registerPermissionsIpc(broker as any, ruleStore as any, createUi(), { resolveCwd: vi.fn(), protectedRoots: [] });

    await expect(decideAlways('global', 'external_read(C:/*)')).rejects.toThrow(/不一致/);
    expect(ruleStore.addRule).not.toHaveBeenCalled();

    await expect(decideAlways('workspace', 'write(草稿/*)')).resolves.toEqual({ accepted: true });
  });

  it('grants a picked directory as global allow rules and leaves rules untouched when the picker is cancelled', async () => {
    const picked = await mkdtemp(path.join(os.tmpdir(), 'chaptale-grant-'));
    tempDirs.push(picked);
    const directory = `${(await realpath(picked)).replaceAll(path.sep, '/').replace(/^[a-z]:/, drive => drive.toUpperCase())}/`;
    const ruleStore = {
      addPersistentRule: vi.fn().mockResolvedValue(undefined),
      listPersistentRules: vi.fn().mockResolvedValue({ workspace: [], global: [] })
    };
    const grant = (ui: ReturnType<typeof createUi>, access: 'read' | 'write') => {
      registerPermissionsIpc({ onAsk: vi.fn() } as any, ruleStore as any, ui, {
        resolveCwd: vi.fn().mockResolvedValue('/workspace-b'),
        protectedRoots: []
      });
      return ipcMock.listeners.get(IPC_CHANNELS.permissions.grantExternalDirectory)?.({}, { access });
    };

    await expect(grant(createUi(picked), 'write')).resolves.toEqual([]);
    expect(ruleStore.addPersistentRule.mock.calls).toEqual([
      [{ pattern: `external_read(${directory}*)`, action: 'allow' }, 'global', null],
      [{ pattern: `external_write(${directory}*)`, action: 'allow' }, 'global', null]
    ]);

    ruleStore.addPersistentRule.mockClear();
    await grant(createUi(undefined), 'read');
    expect(ruleStore.addPersistentRule).not.toHaveBeenCalled();
  });

  it('refuses to grant a directory inside the Chaptale config root', async () => {
    const configRoot = await mkdtemp(path.join(os.tmpdir(), 'chaptale-config-'));
    tempDirs.push(configRoot);
    const ruleStore = { addPersistentRule: vi.fn(), listPersistentRules: vi.fn() };
    registerPermissionsIpc({ onAsk: vi.fn() } as any, ruleStore as any, createUi(configRoot), {
      resolveCwd: vi.fn(),
      protectedRoots: [configRoot]
    });

    await expect(
      ipcMock.listeners.get(IPC_CHANNELS.permissions.grantExternalDirectory)?.({}, { access: 'read' })
    ).rejects.toThrow(/配置目录/);
    expect(ruleStore.addPersistentRule).not.toHaveBeenCalled();
  });
});
