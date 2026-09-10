import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { createDefaultToolCatalog } from '../../../core/tool-protocol/catalog';
import type { SkillDescriptor } from '../../skills/provider-port';
import { createChatRuntimeBundle } from '../chat-bundle';

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

async function createSkillFile(body: string): Promise<SkillDescriptor> {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-bundle-skill-'));
  tempDirs.push(dir);
  const filePath = path.join(dir, 'SKILL.md');
  await writeFile(filePath, body, 'utf8');

  return { name: 'review-checklist', description: '审查清单', filePath };
}

const companion: PersonaDefinition = {
  id: 'companion',
  name: '创作伙伴',
  type: 'chat',
  execution: 'chat',
  body: '提示词',
  source: 'builtin'
};

function createBundle(
  options: {
    persona?: PersonaDefinition | null;
    skills?: SkillDescriptor[];
    skillInjection?: 'inline' | 'on-demand';
  } = {}
) {
  const persona = options.persona === undefined ? companion : options.persona;
  const skillsProvider = options.skills
    ? { load: vi.fn(async () => ({ skills: options.skills, diagnostics: [] })) }
    : undefined;

  return createChatRuntimeBundle({
    personaRegistry: {
      get: vi.fn(async () => persona),
      load: vi.fn(async () => ({ personas: [], diagnostics: [] }))
    },
    taskRunner: { run: vi.fn() },
    toolCatalog: createDefaultToolCatalog(),
    todoStore: { replace: vi.fn(), read: vi.fn(async () => []) },
    subagentPool: { run: vi.fn(), cancel: vi.fn() },
    memoryPendingStore: { add: vi.fn() },
    memorySearchService: { search: vi.fn() },
    webToolsSettingsStore: { read: vi.fn() },
    modelService: {
      listModels: vi.fn(async () => ({ defaultModel: { provider: 'prov', modelId: 'model-1' } })),
      runtime: { resolveModel: vi.fn(async () => ({ model: {} })) }
    },
    ...(skillsProvider ? { skillsProvider } : {}),
    ...(options.skillInjection ? { skillInjection: options.skillInjection } : {})
  } as never);
}

describe('chat-bundle 工具装配', () => {
  it('默认白名单同时挂载文件六工具与注册工具（回归：文件工具曾被错误过滤为空）', async () => {
    const bundle = createBundle();
    const { tools } = await bundle.resolve({ sessionId: 'session-1', cwd: '/workspace' });

    const names = tools.map(tool => tool.name);
    expect(names).toEqual(
      expect.arrayContaining(['read', 'grep', 'find', 'ls', 'write', 'edit', 'todo_write', 'delegate', 'memory_search'])
    );
    expect(names).toHaveLength(14);
  });

  it('显式 tools 白名单对注册工具与文件工具统一收窄', async () => {
    const bundle = createBundle({ persona: { ...companion, tools: ['read', 'memory_search'] } });
    const { tools } = await bundle.resolve({ sessionId: 'session-1', cwd: '/workspace' });

    expect(tools.map(tool => tool.name).toSorted()).toEqual(['memory_search', 'read']);
  });

  it('on-demand 缺省：system 只含技能索引，正文经 skill_read 按需读取', async () => {
    const skill = await createSkillFile('秘密正文');
    const bundle = createBundle({ skills: [skill] });
    const { system, tools } = await bundle.resolve({ sessionId: 'session-1', cwd: '/workspace' });

    // 索引一行一条，正文不进 system。
    expect(system).toContain('- review-checklist：审查清单');
    expect(system).not.toContain('秘密正文');
    expect(system).toContain('skill_read');
    // 有适用技能 → 挂 skill_read。
    expect(tools.map(tool => tool.name)).toContain('skill_read');
  });

  it('inline 形态保留历史行为：SKILL.md 正文拼入 system', async () => {
    const skill = await createSkillFile('秘密正文');
    const bundle = createBundle({ skills: [skill], skillInjection: 'inline' });
    const { system } = await bundle.resolve({ sessionId: 'session-1', cwd: '/workspace' });

    expect(system).toContain('秘密正文');
  });

  it('无适用技能时不挂 skill_read', async () => {
    const bundle = createBundle();
    const { tools } = await bundle.resolve({ sessionId: 'session-1', cwd: '/workspace' });

    expect(tools.map(tool => tool.name)).not.toContain('skill_read');
  });
});
