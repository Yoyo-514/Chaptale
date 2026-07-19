import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  listAll: vi.fn(),
  open: vi.fn(),
  settingsCreate: vi.fn(),
  loaderReload: vi.fn(async () => undefined),
  loaderOptions: undefined as unknown
}));

vi.mock('@earendil-works/pi-coding-agent', async importOriginal => ({
  // parseFrontmatter 是纯函数，PersonaRegistry 真实依赖它解析内置 persona，透传原实现。
  parseFrontmatter: (await importOriginal<typeof import('@earendil-works/pi-coding-agent')>()).parseFrontmatter,
  createAgentSession: sdkMocks.createAgentSession,
  DefaultResourceLoader: class {
    constructor(options: unknown) {
      sdkMocks.loaderOptions = options;
    }

    reload = sdkMocks.loaderReload;
  },
  SessionManager: {
    listAll: sdkMocks.listAll,
    open: sdkMocks.open
  },
  SettingsManager: {
    create: sdkMocks.settingsCreate
  }
}));

import { PiAgentSessionFactory } from '../session-factory';

let rootDir: string;

beforeEach(async () => {
  vi.clearAllMocks();
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-session-factory-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('PiAgentSessionFactory', () => {
  it('passes the model service shared ModelRuntime to createAgentSession', async () => {
    const sessionsRootDir = path.join(rootDir, 'sessions');
    const sessionDir = path.join(sessionsRootDir, 'global');
    const sessionPath = path.join(sessionDir, 'session-1.jsonl');
    await mkdir(sessionDir, { recursive: true });

    const target = { id: 'session-1', cwd: rootDir, path: sessionPath };
    const sessionManager = { id: 'manager' };
    const settingsManager = { id: 'settings' };
    const modelRuntime = { id: 'runtime' };
    const session = { id: 'agent-session' };
    sdkMocks.listAll.mockResolvedValue([target]);
    sdkMocks.open.mockReturnValue(sessionManager);
    sdkMocks.settingsCreate.mockReturnValue(settingsManager);
    sdkMocks.createAgentSession.mockResolvedValue({ session });

    const settingsService = {
      rootDir,
      agentDir: path.join(rootDir, 'agent'),
      sessionsRootDir,
      getCurrentSessionDir: vi.fn(async () => sessionDir),
      getCurrentCwd: vi.fn(async () => rootDir)
    };
    const modelService = {
      getModelRuntime: vi.fn(async () => modelRuntime)
    };
    const skillsProvider = {
      load: vi.fn(() => ({ skills: [], diagnostics: [] }))
    };
    const factory = new PiAgentSessionFactory({
      settingsService: settingsService as any,
      modelService: modelService as any,
      skillsProvider: skillsProvider as any
    });

    await expect(factory.create('session-1')).resolves.toBe(session);
    expect(modelService.getModelRuntime).toHaveBeenCalledOnce();
    expect(sdkMocks.createAgentSession).toHaveBeenCalledWith(
      expect.objectContaining({
        modelRuntime,
        sessionManager,
        settingsManager
      })
    );
    expect(sdkMocks.createAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('authStorage');
    expect(sdkMocks.createAgentSession.mock.calls[0]?.[0]).not.toHaveProperty('modelRegistry');
  });
});
