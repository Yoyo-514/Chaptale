import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sdkMocks = vi.hoisted(() => ({
  createAgentSession: vi.fn(),
  listAll: vi.fn(),
  open: vi.fn(),
  sessionCreate: vi.fn(),
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
    open: sdkMocks.open,
    create: sdkMocks.sessionCreate
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
      skillsProvider: skillsProvider as any,
      todoStore: { replace: vi.fn(), read: vi.fn(async () => []) } as any
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

  describe('createTaskSession', () => {
    function createTaskFactory(model: any = { provider: 'p', id: 'm' }) {
      const sessionManager = { id: 'task-manager' };
      const settingsManager = { id: 'settings' };
      const session: any = {
        id: 'task-session',
        model: undefined,
        setModel: vi.fn(async (m: any) => (session.model = m))
      };
      sdkMocks.sessionCreate.mockReturnValue(sessionManager);
      sdkMocks.settingsCreate.mockReturnValue(settingsManager);
      sdkMocks.createAgentSession.mockResolvedValue({ session });

      const settingsService = {
        rootDir,
        agentDir: path.join(rootDir, 'agent'),
        sessionsRootDir: path.join(rootDir, 'sessions'),
        taskSessionsDir: path.join(rootDir, 'task-sessions'),
        getCurrentCwd: vi.fn(async () => rootDir)
      };
      const modelService = {
        getModelRuntime: vi.fn(async () => ({ getModel: vi.fn(() => undefined) })),
        // null 哨兵表示"未配置"；不能用 undefined，否则触发默认参数。
        getDefaultPiModel: vi.fn(async () => (model === null ? undefined : model))
      };
      const factory = new PiAgentSessionFactory({
        settingsService: settingsService as any,
        modelService: modelService as any,
        skillsProvider: { load: vi.fn(() => ({ skills: [], diagnostics: [] })) } as any,
        todoStore: { replace: vi.fn(), read: vi.fn(async () => []) } as any
      });

      return { factory, session, settingsService };
    }

    const spec = { personaId: 'test-reviewer', systemPrompt: '你是测试审查专员。', tools: [] };

    it('creates the session under taskSessionsDir, outside history scanning', async () => {
      const { factory, session, settingsService } = createTaskFactory();

      await expect(factory.createTaskSession(spec)).resolves.toBe(session);
      expect(sdkMocks.sessionCreate).toHaveBeenCalledWith(rootDir, settingsService.taskSessionsDir);
      // 主对话的历史发现链路（listAll/open）不参与 task session。
      expect(sdkMocks.listAll).not.toHaveBeenCalled();
      expect(sdkMocks.open).not.toHaveBeenCalled();
    });

    it('suppresses all tools for analysis personas and passes tool subsets through', async () => {
      const { factory } = createTaskFactory();

      await factory.createTaskSession(spec);
      expect(sdkMocks.createAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({ tools: [], noTools: 'all' })
      );

      await factory.createTaskSession({ ...spec, tools: ['read', 'grep'] });
      const lastCall = sdkMocks.createAgentSession.mock.calls.at(-1)?.[0];
      expect(lastCall.tools).toEqual(['read', 'grep']);
      expect(lastCall).not.toHaveProperty('noTools');
    });

    it('builds the system prompt from the persona body, immune to user SYSTEM.md', async () => {
      const { factory } = createTaskFactory();

      await factory.createTaskSession(spec);

      const loaderOptions = sdkMocks.loaderOptions as {
        systemPromptOverride: (discovered: string | undefined) => string;
        appendSystemPromptOverride: (base: string[]) => string[];
      };
      const prompt = loaderOptions.systemPromptOverride('用户 SYSTEM.md 内容');

      expect(prompt).toContain('你是测试审查专员。');
      expect(prompt).not.toContain('用户 SYSTEM.md 内容');
      expect(prompt).toContain('记忆协议');
      expect(loaderOptions.appendSystemPromptOverride(['用户追加'])).toEqual([]);
    });

    it('applies the default model and fails when none is configured', async () => {
      const { factory, session } = createTaskFactory();
      await factory.createTaskSession(spec);
      expect(session.setModel).toHaveBeenCalledWith({ provider: 'p', id: 'm' });

      const { factory: noModelFactory } = createTaskFactory(null);
      await expect(noModelFactory.createTaskSession(spec)).rejects.toThrow(/尚未配置可用模型/);
    });
  });
});
