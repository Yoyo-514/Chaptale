import { describe, expect, it, vi } from 'vitest';

import type { TaskPersonaSpec } from '../../personas/task-spec';
import { TaskSessionFactory } from '../session-factory';

const { createTaskSessionMock } = vi.hoisted(() => ({
  createTaskSessionMock: vi.fn((options: { tools: Array<{ name: string }> }) => ({
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

function createFactory(options: { skills?: string[] } = {}) {
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
    }
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
