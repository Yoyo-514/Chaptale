import { describe, expect, it, vi } from 'vitest';

import type { PersonaDefinition } from '@chaptale/shared';

import { estimateTextTokens } from '../../../core/context/token-counter';
import { CompactCoord } from '../compact-coord';

const persona = {
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

function createCoord(order: string[] = []) {
  const deps = {
    personas: {
      get: vi.fn(async (_cwd: string, _id: string): Promise<PersonaDefinition | undefined> => persona)
    },
    tasks: {
      run: vi.fn(async (_input: any) => {
        order.push('distill');
        return {
          status: 'success' as const,
          runId: 'run-distill',
          output: checkpoint,
          outputRef: '.chaptale/runs/outputs/run-distill.md',
          usage: { inputTokens: 100, outputTokens: 50 }
        };
      })
    },
    memory: {
      readSections: vi.fn(async () => ({
        preferences: '偏好克制叙事',
        styleGuide: '禁止全知视角',
        recent: '上一章停在旧照片出现',
        notes: '伤势.md: 林晚左眼已盲'
      }))
    },
    summaries: {
      save: vi.fn(async (_input: any) => {
        order.push('save');
        return {
          outputRef: '.chaptale/memory/summaries/compactions/checkpoint.md',
          summary: '# 创作会话检查点\n\n## 当前目标\n继续完成第三章夜谈'
        };
      })
    }
  };

  return { coord: new CompactCoord(deps), deps };
}

const input = {
  sessionId: 'session-1',
  cwd: '/session-workspace',
  reason: 'manual' as const,
  checkpointId: 'entry-42',
  tokensBefore: 72_000,
  previousSummary: '上一轮会话检查点',
  conversation: '[用户] 继续第三章\n[助手] 已完成入口段落',
  turnPrefix: '[用户] 重写夜谈场景',
  maxInputTokens: 80_000
};

describe('CompactCoord', () => {
  it('先蒸馏并保存 memory 检查点，再返回可交给 pi 的摘要', async () => {
    const order: string[] = [];
    const { coord, deps } = createCoord(order);

    const result = await coord.run(input);

    expect(order).toEqual(['distill', 'save']);
    expect(deps.tasks.run).toHaveBeenCalledWith(
      expect.objectContaining({
        persona,
        trigger: 'ui-action',
        parentSessionId: 'session-1',
        brief: expect.stringContaining('创作会话检查点'),
        text: expect.stringContaining('上一轮会话检查点')
      })
    );
    expect(deps.tasks.run.mock.calls[0]![0].text).toContain('偏好克制叙事');
    expect(deps.tasks.run.mock.calls[0]![0].text).toContain('继续第三章');
    expect(deps.summaries.save).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionId: 'session-1',
        cwd: '/session-workspace',
        reason: 'manual',
        checkpointId: 'entry-42',
        distillerRunId: 'run-distill',
        tokensBefore: 72_000,
        memoryRefs: [
          'author:preferences',
          'workspace:设定/创作守则.md',
          'workspace:.chaptale/memory/summaries/recent.md',
          'workspace:.chaptale/memory/notes/'
        ]
      })
    );
    expect(result).toMatchObject({
      summaryRef: '.chaptale/memory/summaries/compactions/checkpoint.md',
      runId: 'run-distill',
      memoryRefs: expect.arrayContaining(['author:preferences'])
    });
    expect(deps.personas.get).toHaveBeenCalledWith('/session-workspace', 'memory-distiller');
    expect(deps.memory.readSections).toHaveBeenCalledWith('/session-workspace');
    expect(result.summary).toContain('## 当前目标');
  });

  it('蒸馏失败时不写摘要并阻止压缩', async () => {
    const { coord, deps } = createCoord();
    deps.tasks.run.mockResolvedValueOnce({
      status: 'failed',
      runId: 'run-failed',
      errors: ['输出不符合 schema'],
      outputRef: '.chaptale/runs/outputs/run-failed.md',
      usage: { inputTokens: 100, outputTokens: 20 }
    } as any);

    await expect(coord.run(input)).rejects.toThrow('memory-distiller 执行失败');
    expect(deps.summaries.save).not.toHaveBeenCalled();
  });

  it('memory 检查点落盘失败时不返回 compaction 结果', async () => {
    const { coord, deps } = createCoord();
    deps.summaries.save.mockRejectedValueOnce(new Error('磁盘只读'));

    await expect(coord.run(input)).rejects.toThrow('磁盘只读');
  });

  it('按模型预算裁剪超长输入，同时保留首尾证据', async () => {
    const { coord, deps } = createCoord();
    const huge = `开头证据-${'中'.repeat(20_000)}-结尾证据`;

    await coord.run({ ...input, conversation: huge, maxInputTokens: 2_000 });

    const text = deps.tasks.run.mock.calls[0]![0].text;
    expect(estimateTextTokens(text)).toBeLessThanOrEqual(2_000);
    expect(text).toContain('开头证据');
    expect(text).toContain('结尾证据');
    expect(text).toContain('已按 token 预算省略内容');
  });

  it('拒绝不可用 persona，避免退回普通摘要器', async () => {
    const { coord, deps } = createCoord();
    deps.personas.get.mockResolvedValueOnce(undefined);

    await expect(coord.run(input)).rejects.toThrow('memory-distiller persona 不可用');
    expect(deps.tasks.run).not.toHaveBeenCalled();
  });
});
