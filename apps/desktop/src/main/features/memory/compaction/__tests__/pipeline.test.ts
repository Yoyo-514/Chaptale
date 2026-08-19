import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { createProtocolLanguageModel } from '../../../../core/models/protocols';
import type { ResolvedModel } from '../../../../core/models/runtime';
import { SessionStore } from '../../../../core/sessions/store';
import { AgentService } from '../../../agent/service';
import { JsonlSessionRepository } from '../../../sessions/repository';
import { MemoryService } from '../../service';
import { CompactCoord } from '../coord';
import { CompactionSummaryStore } from '../summary-store';

/**
 * 压缩管线接缝验收：AgentService → compactSession → CompactCoord → 真实检查点落盘。
 *
 * 接缝断裂时模块内部的单测一条都不会变红——实现完整、依赖就位，只是没人调用它。
 * 因此这条测试盯的是装配而不是模块：检查点必须真的落到磁盘上。
 */

let dir: string;
let workspace: string;
let repository: JsonlSessionRepository;

const distillerPersona = {
  id: 'memory-distiller',
  name: '会话记忆蒸馏',
  execution: 'task',
  type: 'custom',
  body: '蒸馏创作检查点',
  tools: [],
  output: 'creative-checkpoint',
  enabled: true,
  source: 'builtin'
} satisfies PersonaDefinition;

const checkpoint = {
  objective: '继续完成第三章夜谈',
  authorConstraints: ['不得揭露顾沉的真实身份'],
  confirmedFacts: ['林晚左眼已盲'],
  creativeState: ['林晚已经看到旧照片'],
  decisions: ['采用林晚限知视角'],
  unresolved: ['照片来源尚未确认'],
  recentProgress: ['完成车间入口段落'],
  nextIntent: ['续写林晚试探顾沉']
};

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-compact-pipeline-'));
  workspace = path.join(dir, 'workspace');
  repository = new JsonlSessionRepository({
    rootDir: dir,
    cwd: workspace,
    sessionDir: path.join(dir, 'sessions', 'workspace'),
    sessionsRootDir: path.join(dir, 'sessions')
  });
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

function createModel(): ResolvedModel {
  return {
    model: createProtocolLanguageModel(
      { providerId: 't', api: 'openai-completions', baseUrl: 'https://t.local/v1', apiKey: 'k' },
      'm'
    ),
    provider: 't',
    modelId: 'm',
    contextWindow: 128_000,
    input: ['text']
  };
}

function createPipeline(
  taskRun = vi.fn(async () => ({ status: 'success' as const, runId: 'run-distill', output: checkpoint }))
) {
  const coord = new CompactCoord({
    personas: { get: async () => distillerPersona },
    tasks: { run: taskRun },
    memory: new MemoryService({ chaptaleRootDir: path.join(dir, 'agent') }),
    // 真实实现：检查点确实要落到磁盘，这正是接缝断裂时会失败的地方。
    summaries: new CompactionSummaryStore()
  });

  const service = new AgentService({
    sessionRepository: repository,
    modelService: {} as never,
    runtimeBundle: {
      resolveModel: async () => createModel(),
      resolve: async () => {
        throw new Error('压缩不应走重路径');
      }
    },
    compactSummarizer: input => coord.run(input)
  });

  return { service, coord, taskRun };
}

async function seedSession(sessionId: string, count: number) {
  const store = await repository.openOrCreate(sessionId, workspace);

  await store.appendMessage({ role: 'user', content: '开始写第三章' });

  for (let index = 0; index < count; index += 1) {
    await store.appendMessage({ role: 'assistant', content: `第${index}段正文`.padEnd(400, '文') });
  }

  return store;
}

describe('会话压缩管线', () => {
  it('检查点先落盘到会话工作区，会话流写入同一正文', async () => {
    await seedSession('s1', 12);
    const { service } = createPipeline();

    const result = await service.compactSession('s1');

    // summaryRef 是真实的 workspace 相对路径，不再是正文预览冒充。
    expect(result.summaryRef).toMatch(/^\.chaptale\/memory\/summaries\/compactions\/.+\.md$/);

    const checkpointFile = await readFile(path.join(workspace, result.summaryRef), 'utf8');
    expect(checkpointFile).toContain('kind: summary');
    expect(checkpointFile).toContain('distillerRunId: "run-distill"');
    expect(checkpointFile).toContain('继续完成第三章夜谈');

    // 会话流里的摘要与检查点文件正文一致——两侧不能各说各话。
    const reopened = await SessionStore.open(path.join(dir, 'sessions', 'workspace', 's1.jsonl'));
    const context = reopened.buildContextMessages();

    expect(context[0]).toMatchObject({ role: 'user' });
    expect(String((context[0] as { content: string }).content)).toContain('继续完成第三章夜谈');
    expect(checkpointFile).toContain(String((context[0] as { content: string }).content).trim());

    // 近期原文按预算保留，压缩后确实变小。
    expect(context.length).toBeGreaterThanOrEqual(2);
    expect(result.estimatedTokensAfter).toBeLessThan(result.tokensBefore);
  });

  it('蒸馏用的是会话绑定的工作区，不是全局 currentCwd', async () => {
    await seedSession('s1', 4);
    const { service, taskRun } = createPipeline();

    await service.compactSession('s1');

    expect(taskRun).toHaveBeenCalledWith(expect.objectContaining({ cwd: workspace, parentSessionId: 's1' }));
  });

  it('蒸馏失败时会话保持原样：不写 compaction entry，也不留检查点', async () => {
    const store = await seedSession('s1', 4);
    const entriesBefore = store.entries.length;
    const { service } = createPipeline(
      vi.fn(async () => ({ status: 'failed' as const, runId: 'run-x', errors: ['输出不符合 schema'] })) as never
    );

    await expect(service.compactSession('s1')).rejects.toThrow(/memory-distiller 执行失败/);

    const reopened = await SessionStore.open(path.join(dir, 'sessions', 'workspace', 's1.jsonl'));
    expect(reopened.entries).toHaveLength(entriesBefore);
    expect(reopened.entries.some(entry => entry.type === 'compaction')).toBe(false);
  });

  it('persona 被停用时拒绝压缩，而不是退回普通摘要器', async () => {
    await seedSession('s1', 4);
    const coord = new CompactCoord({
      personas: { get: async () => ({ ...distillerPersona, enabled: false }) },
      tasks: { run: vi.fn() as never },
      memory: new MemoryService({ chaptaleRootDir: path.join(dir, 'agent') }),
      summaries: new CompactionSummaryStore()
    });
    const service = new AgentService({
      sessionRepository: repository,
      modelService: {} as never,
      runtimeBundle: {
        resolveModel: async () => createModel(),
        resolve: async () => {
          throw new Error('压缩不应走重路径');
        }
      },
      compactSummarizer: input => coord.run(input)
    });

    await expect(service.compactSession('s1')).rejects.toThrow(/persona 不可用/);
  });
});
