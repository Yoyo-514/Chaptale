import { describe, expect, it, vi } from 'vitest';

import type { PermissionGatePort } from '../../../core/agent/types';
import type { TaskPersonaSpec } from '../../personas/task-spec';
import { TaskSessionFactory, type TaskSessionFactoryOptions } from '../session-factory';

const { createTaskSessionMock } = vi.hoisted(() => ({
  createTaskSessionMock: vi.fn((options: { tools: Array<{ name: string }>; gate?: PermissionGatePort }) => ({
    prompt: vi.fn(),
    abort: vi.fn(),
    getLastAssistantText: vi.fn(() => undefined),
    getUsage: vi.fn(() => ({ inputTokens: 0, outputTokens: 0 })),
    dispose: vi.fn(),
    tools: options.tools
  }))
}));

vi.mock('../session', () => ({ createTaskSession: createTaskSessionMock }));

const baseSpec: TaskPersonaSpec = {
  personaId: 'continuity-reviewer',
  systemPrompt: '你是审查专员。',
  modelPreference: undefined,
  tools: [],
  skills: [],
  memoryReadDomains: []
};

function createFactory(
  options: { skills?: string[]; createDelegatedGate?: TaskSessionFactoryOptions['createDelegatedGate'] } = {}
) {
  const factory = new TaskSessionFactory({
    settingsService: { getCurrentCwd: vi.fn(async () => '/workspace') } as never,
    modelService: {
      listModels: vi.fn(async () => ({ defaultModel: { provider: 'prov', modelId: 'model-1' } })),
      runtime: { resolveModel: vi.fn(async () => ({ model: {} })) }
    } as never,
    buildTaskTools: vi.fn(async () => []),
    skillsProvider: {
      load: vi.fn(async () => ({
        skills: [
          {
            name: 'review-checklist',
            description: '审查清单',
            filePath: '/nonexistent/SKILL.md',
            source: 'builtin',
            appliesTo: []
          }
        ],
        diagnostics: []
      }))
    },
    ...(options.createDelegatedGate ? { createDelegatedGate: options.createDelegatedGate } : {})
  });

  const spec: TaskPersonaSpec = { ...baseSpec, skills: options.skills ?? [] };

  return { factory, spec };
}

describe('TaskSessionFactory skill_read 挂载', () => {
  it('声明了 skills 的 persona 获得 skill_read，且不受 tools 白名单约束', async () => {
    const { factory, spec } = createFactory({ skills: ['review-checklist'] });
    await factory.createTaskSession(spec);

    const tools = createTaskSessionMock.mock.calls.at(-1)?.[0].tools.map(tool => tool.name) ?? [];
    expect(tools).toEqual(['skill_read']);
  });

  it('未声明 skills 的 persona 不挂 skill_read', async () => {
    const { factory, spec } = createFactory();
    await factory.createTaskSession(spec);

    const tools = createTaskSessionMock.mock.calls.at(-1)?.[0].tools.map(tool => tool.name) ?? [];
    expect(tools).toEqual([]);
  });
});

describe('TaskSessionFactory 授权闸门', () => {
  it('委派子任务改用宿主会话的闸门，并带上宿主会话、子任务名与作品', async () => {
    const delegatedGate: PermissionGatePort = { check: vi.fn() };
    const createDelegatedGate = vi.fn(() => delegatedGate);
    const { factory, spec } = createFactory({ createDelegatedGate });

    await factory.createTaskSession(spec, '/workspace', undefined, {
      parentSessionId: 'chat-1',
      requester: '资料专员'
    });

    expect(createDelegatedGate).toHaveBeenCalledWith({
      parentSessionId: 'chat-1',
      requester: '资料专员',
      cwd: '/workspace'
    });
    expect(createTaskSessionMock.mock.calls.at(-1)?.[0].gate).toBe(delegatedGate);
  });

  it('非委派任务无人值守：只读放行，作品外读取等其余请求直接拒绝', async () => {
    const createDelegatedGate = vi.fn();
    const { factory, spec } = createFactory({ createDelegatedGate });

    await factory.createTaskSession(spec, '/workspace');
    const gate = createTaskSessionMock.mock.calls.at(-1)?.[0].gate;

    expect(createDelegatedGate).not.toHaveBeenCalled();
    await expect(
      gate?.check({ sessionId: 'task', toolName: 'read', riskLevel: 'readonly', args: {} })
    ).resolves.toEqual({ outcome: 'allow-once' });
    await expect(
      gate?.check({ sessionId: 'task', toolName: 'external_read', riskLevel: 'sensitive', args: {} })
    ).resolves.toMatchObject({ outcome: 'deny' });
  });
});
