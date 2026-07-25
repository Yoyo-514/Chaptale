import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Type } from 'typebox';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

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

import type { TaskPersonaSpec } from '../../../../modules/personas/task-spec';
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
    const workspaceDir = path.join(rootDir, 'workspace-a');
    const sessionDir = path.join(sessionsRootDir, 'workspace-a');
    const sessionPath = path.join(sessionDir, 'session-1.jsonl');
    await mkdir(sessionDir, { recursive: true });

    const target = { id: 'session-1', cwd: workspaceDir, path: sessionPath };
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
      todoStore: { replace: vi.fn(), read: vi.fn(async () => []) } as any,
      permissionBroker: { ask: vi.fn(), onAsk: vi.fn(), rejectSession: vi.fn() } as any,
      permissionRuleStore: { collect: vi.fn(async () => []), clearSession: vi.fn() } as any
    });
    const compactExt = { name: 'test-compact', hidden: true, factory: vi.fn() };
    const buildCompactExt = vi.fn(() => compactExt);
    factory.setCompactExt(buildCompactExt as any);

    const bound = await factory.create('session-1');

    expect(bound.ctx).toEqual({
      sessionId: 'session-1',
      cwd: workspaceDir,
      scope: 'workspace'
    });
    expect(bound.session).toBe(session);
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
    expect(buildCompactExt).toHaveBeenCalledWith('session-1', workspaceDir);
    expect((sdkMocks.loaderOptions as any).extensionFactories).toContain(compactExt);
  });

  it('applies the companion whitelist and binds security context to the session workspace', async () => {
    const sessionCwd = path.join(rootDir, 'workspace-a');
    const sessionDir = path.join(rootDir, 'sessions', 'workspace-a');
    const sessionPath = path.join(sessionDir, 'session-1.jsonl');
    const currentUiCwd = path.join(rootDir, 'workspace-b');
    await mkdir(sessionDir, { recursive: true });
    sdkMocks.listAll.mockResolvedValue([{ id: 'session-1', cwd: sessionCwd, path: sessionPath }]);
    sdkMocks.open.mockReturnValue({ id: 'manager' });
    sdkMocks.settingsCreate.mockReturnValue({ id: 'settings' });
    sdkMocks.createAgentSession.mockResolvedValue({ session: { id: 'agent-session' } });
    const companion: PersonaDefinition = {
      id: 'companion',
      name: '受限伙伴',
      type: 'chat' as const,
      execution: 'chat' as const,
      body: '受限伙伴提示词',
      source: 'workspace' as const,
      tools: ['memory_search'],
      memory: { read: ['canon'], write: [], propose: [] }
    };
    const settingsService = {
      rootDir,
      agentDir: path.join(rootDir, 'agent'),
      sessionsRootDir: path.join(rootDir, 'sessions'),
      getCurrentSessionDir: vi.fn(async () => sessionDir),
      getCurrentCwd: vi.fn(async () => currentUiCwd)
    };
    const personaRegistry = { get: vi.fn(async () => companion) };
    const skillsProvider = { load: vi.fn(() => ({ skills: [], diagnostics: [] })) };
    const factory = new PiAgentSessionFactory({
      settingsService: settingsService as any,
      modelService: { getModelRuntime: vi.fn(async () => ({ id: 'runtime' })) } as any,
      skillsProvider: skillsProvider as any,
      todoStore: { replace: vi.fn(), read: vi.fn(async () => []) } as any,
      permissionBroker: { ask: vi.fn(), onAsk: vi.fn(), rejectSession: vi.fn() } as any,
      permissionRuleStore: { collect: vi.fn(async () => []), clearSession: vi.fn() } as any,
      personaRegistry: personaRegistry as any
    });
    const buildTools = vi.fn(async () => [
      {
        name: 'memory_search',
        label: '检索作品记忆',
        description: 'search',
        riskLevel: 'readonly' as const,
        parameters: Type.Object({ query: Type.String() }),
        execute: vi.fn(async () => ({ text: 'result' }))
      },
      {
        name: 'memory_save',
        label: '保存记忆',
        description: 'save',
        parameters: Type.Object({}),
        execute: vi.fn(async () => ({ text: 'saved' }))
      }
    ]);
    factory.setExtraChatTools(buildTools);

    await factory.create('session-1');

    expect(personaRegistry.get).toHaveBeenCalledWith(sessionCwd, 'companion');
    (sdkMocks.loaderOptions as any).skillsOverride();
    expect(skillsProvider.load).toHaveBeenCalledWith(sessionCwd, 'companion');
    expect(buildTools).toHaveBeenCalledWith({ sessionId: 'session-1', cwd: sessionCwd, persona: companion });
    const options = sdkMocks.createAgentSession.mock.calls.at(-1)?.[0];
    expect(options.cwd).toBe(sessionCwd);
    expect(options.tools).toEqual(['memory_search']);
    expect(options.customTools).toEqual([expect.objectContaining({ name: 'memory_search' })]);

    personaRegistry.get.mockResolvedValue({ ...companion, tools: undefined });
    await factory.create('session-1');
    const defaultOptions = sdkMocks.createAgentSession.mock.calls.at(-1)?.[0];
    expect(defaultOptions.tools).toEqual(
      expect.arrayContaining(['read', 'grep', 'web_search', 'memory_search', 'memory_save'])
    );
    expect(defaultOptions.customTools.map((tool: { name: string }) => tool.name)).toEqual([
      'memory_search',
      'memory_save'
    ]);

    sdkMocks.listAll.mockResolvedValue([{ id: 'session-1', cwd: '', path: sessionPath }]);
    settingsService.getCurrentCwd.mockClear();
    await expect(factory.create('session-1')).rejects.toThrow(/会话缺少 workspace/);
    expect(settingsService.getCurrentCwd).not.toHaveBeenCalled();
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
        todoStore: { replace: vi.fn(), read: vi.fn(async () => []) } as any,
        permissionBroker: { ask: vi.fn(), onAsk: vi.fn(), rejectSession: vi.fn() } as any,
        permissionRuleStore: { collect: vi.fn(async () => []), clearSession: vi.fn() } as any
      });

      return { factory, session, settingsService };
    }

    const spec = {
      personaId: 'test-reviewer',
      systemPrompt: '你是测试审查专员。',
      tools: [],
      memoryReadDomains: []
    };

    it('creates the session under taskSessionsDir, outside history scanning', async () => {
      const { factory, session, settingsService } = createTaskFactory();

      await expect(factory.createTaskSession(spec)).resolves.toBe(session);
      expect(sdkMocks.sessionCreate).toHaveBeenCalledWith(rootDir, settingsService.taskSessionsDir);
      // 主对话的历史发现链路（listAll/open）不参与 task session。
      expect(sdkMocks.listAll).not.toHaveBeenCalled();
      expect(sdkMocks.open).not.toHaveBeenCalled();
    });

    it('blocks native compaction in one-shot task sessions', async () => {
      const { factory } = createTaskFactory();
      await factory.createTaskSession(spec);

      const extensions = (sdkMocks.loaderOptions as any).extensionFactories as any[];
      const guard = extensions.find(extension => extension.name === 'chaptale-task-no-compact');
      let handler: (() => Promise<unknown>) | undefined;
      guard.factory({
        on: (name: string, value: () => Promise<unknown>) => {
          if (name === 'session_before_compact') handler = value;
        }
      });

      expect(handler).toBeDefined();
      await expect(handler!()).resolves.toEqual({ cancel: true });
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

    it('mounts explicitly declared task custom tools', async () => {
      const { factory } = createTaskFactory();
      const execute = vi.fn(async () => ({ text: 'result' }));
      const buildTaskTools = vi.fn(async () => [
        {
          name: 'memory_search',
          label: '检索作品记忆',
          description: 'search',
          riskLevel: 'readonly' as const,
          parameters: Type.Object({ query: Type.String() }),
          execute
        }
      ]);
      factory.setExtraTaskTools(buildTaskTools);
      const searchSpec: TaskPersonaSpec = {
        ...spec,
        tools: ['memory_search'],
        memoryReadDomains: ['canon', 'summaries']
      };

      await factory.createTaskSession(searchSpec);

      expect(buildTaskTools).toHaveBeenCalledWith(searchSpec, rootDir);
      expect(sdkMocks.createAgentSession).toHaveBeenLastCalledWith(
        expect.objectContaining({
          tools: ['memory_search'],
          customTools: [expect.objectContaining({ name: 'memory_search' })]
        })
      );
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
      // task 会话零工具零记忆通道，记忆协议不应注入。
      expect(prompt).not.toContain('记忆协议');
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
