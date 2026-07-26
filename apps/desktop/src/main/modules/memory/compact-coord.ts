import type { CreativeCheckpoint, PersonaDefinition } from '@chaptale/shared';
import { validateOutput } from '@chaptale/shared';

import { estimateTextTokens, fitTextToTokens } from '../../core/context/token-counter';
import type { PersonaRegistry } from '../personas/registry';
import type { CompactionSummaryStore } from './compaction-summary-store';
import type { MemorySections, MemoryService } from './service';

export type CompactReason = 'manual' | 'threshold' | 'overflow';

export type CompactInput = {
  sessionId: string;
  /** 会话创建时绑定的工作区，不能在压缩时改读全局 currentCwd。 */
  cwd: string;
  reason: CompactReason;
  /** pi 选出的首条保留 entry；同时作为检查点幂等标识。 */
  checkpointId: string;
  tokensBefore: number;
  conversation: string;
  turnPrefix?: string;
  previousSummary?: string;
  /** 按当前模型窗口扣除输出与协议开销后的蒸馏输入预算。 */
  maxInputTokens: number;
  signal?: AbortSignal;
};

export type CompactOutput = {
  summary: string;
  summaryRef: string;
  runId: string;
  memoryRefs: string[];
};

type TaskPort = {
  run(input: {
    persona: PersonaDefinition;
    cwd: string;
    brief: string;
    text: string;
    trigger: 'ui-action';
    parentSessionId: string;
    maxPromptTokens: number;
    signal?: AbortSignal;
  }): Promise<
    | { status: 'success'; runId: string; output: unknown }
    | { status: 'failed'; runId: string; errors: string[] }
    | { status: 'cancelled'; runId: string }
  >;
};

type CompactDeps = {
  personas: Pick<PersonaRegistry, 'get'>;
  tasks: TaskPort;
  memory: Pick<MemoryService, 'readSections'>;
  summaries: Pick<CompactionSummaryStore, 'save'>;
};

/**
 * 创作压缩协调器：在 pi 丢弃旧上下文前先生成并持久化检查点。
 * 此模块只依赖领域端口，不接触 pi message、extension 或 session 类型。
 */
export class CompactCoord {
  constructor(private readonly deps: CompactDeps) {}

  async run(input: CompactInput): Promise<CompactOutput> {
    const persona = await this.deps.personas.get(input.cwd, 'memory-distiller');

    if (!persona || persona.enabled === false) {
      throw new Error('memory-distiller persona 不可用，已取消会话压缩');
    }

    const sections = await this.deps.memory.readSections(input.cwd);
    const memoryRefs = collectMemoryRefs(sections);
    const task = await this.deps.tasks.run({
      persona,
      cwd: input.cwd,
      brief: '从待丢弃的长会话中生成创作会话检查点；只提取有依据的信息，不执行章节结算。',
      text: renderInput(input, sections),
      trigger: 'ui-action',
      parentSessionId: input.sessionId,
      maxPromptTokens: input.maxInputTokens,
      ...(input.signal ? { signal: input.signal } : {})
    });

    if (task.status !== 'success') {
      const detail = task.status === 'failed' ? `：${task.errors.join('；')}` : '：任务已取消';
      throw new Error(`memory-distiller 执行失败${detail}`);
    }

    const checked = validateOutput('creative-checkpoint', task.output);
    if (!checked.ok) {
      throw new Error(`memory-distiller 输出无效：${checked.errors.join('；')}`);
    }

    const summary = renderCheckpoint(checked.value as CreativeCheckpoint, memoryRefs);
    const saved = await this.deps.summaries.save({
      sessionId: input.sessionId,
      cwd: input.cwd,
      reason: input.reason,
      checkpointId: input.checkpointId,
      distillerRunId: task.runId,
      summary,
      tokensBefore: input.tokensBefore,
      memoryRefs
    });

    return { summary: saved.summary, summaryRef: saved.outputRef, runId: task.runId, memoryRefs };
  }
}

function renderInput(input: CompactInput, sections: MemorySections): string {
  const items = [
    { title: '已有会话检查点', text: input.previousSummary?.trim() || '（无）', weight: 0.15 },
    { title: '当前动态 Memory', text: renderMemory(sections), weight: 0.15 },
    { title: '待压缩会话', text: input.conversation.trim() || '（无）', weight: 0.5 },
    { title: '超长单轮中即将丢弃的前缀', text: input.turnPrefix?.trim() || '（无）', weight: 0.2 }
  ];
  const overhead = estimateTextTokens(items.map(item => `# ${item.title}\n`).join('\n'));
  const available = Math.max(0, Math.floor(input.maxInputTokens) - overhead);
  const limits = spreadBudget(
    items.map(item => estimateTextTokens(item.text)),
    items.map(item => item.weight),
    available
  );

  return items.map((item, index) => `# ${item.title}\n${fitTextToTokens(item.text, limits[index] ?? 0)}`).join('\n\n');
}

/** 先按 token 权重分配，再把短节省下的预算让给仍被裁剪的节。 */
function spreadBudget(lengths: number[], weights: number[], total: number): number[] {
  const limits = weights.map(weight => Math.floor(total * weight));
  let unused = total - limits.reduce((sum, limit, index) => sum + Math.min(limit, lengths[index] ?? 0), 0);
  const active = new Set(
    lengths.map((length, index) => (length > (limits[index] ?? 0) ? index : -1)).filter(i => i >= 0)
  );

  while (unused > 0 && active.size > 0) {
    const share = Math.max(1, Math.floor(unused / active.size));
    for (const index of active) {
      const missing = (lengths[index] ?? 0) - (limits[index] ?? 0);
      const added = Math.min(share, missing, unused);
      limits[index] = (limits[index] ?? 0) + added;
      unused -= added;
      if (added >= missing) active.delete(index);
      if (unused === 0) break;
    }
  }

  return limits;
}

function renderMemory(sections: MemorySections): string {
  // 节序与 injection-block 的 SECTION_PRIORITY 保持一致：守则 > 偏好 > 近况 > notes。
  const parts = [
    section('创作守则与禁忌', sections.styleGuide),
    section('作者偏好要点', sections.preferences),
    section('最近剧情', sections.recent),
    section('观察笔记清单', sections.notes)
  ].filter(Boolean);

  return parts.join('\n\n') || '（无）';
}

function section(title: string, value: string | undefined): string {
  return value?.trim() ? `## ${title}\n${value.trim()}` : '';
}

/** memory 引用由实际读取结果派生，不能信任模型自行编造路径。 */
function collectMemoryRefs(sections: MemorySections): string[] {
  return [
    ...(sections.preferences ? ['author:preferences'] : []),
    ...(sections.styleGuide ? ['workspace:设定/创作守则.md'] : []),
    ...(sections.recent ? ['workspace:.chaptale/memory/summaries/recent.md'] : []),
    ...(sections.notes ? ['workspace:.chaptale/memory/notes/'] : [])
  ];
}

export function renderCheckpoint(value: CreativeCheckpoint, memoryRefs: string[]): string {
  return [
    '# 创作会话检查点',
    '',
    '## 当前目标',
    value.objective.trim(),
    '',
    listSection('作者约束', value.authorConstraints),
    listSection('已确认事实', value.confirmedFacts),
    listSection('当前创作状态', value.creativeState),
    listSection('已定决策', value.decisions),
    listSection('未决事项', value.unresolved),
    listSection('近期进展', value.recentProgress),
    listSection('下一步意图', value.nextIntent),
    listSection('Memory 引用', memoryRefs)
  ].join('\n');
}

function listSection(title: string, values: string[]): string {
  const items = values.map(item => item.trim()).filter(Boolean);
  return [`## ${title}`, ...(items.length > 0 ? items.map(item => `- ${item}`) : ['- （无）']), ''].join('\n');
}
