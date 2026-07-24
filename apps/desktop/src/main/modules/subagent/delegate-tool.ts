import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';

import type { PersonaDefinition } from '@chaptale/shared';

import type { TaskRunner, TaskRunResult } from '../../integrations/pi/agent/task-runner';
import type { PersonaRegistry } from '../personas/registry';
import type { ToolDefinition } from '../tools/definition';
import type { SubagentPool } from './pool';

export type DelegateToolContext = {
  pool: SubagentPool;
  taskRunner: Pick<TaskRunner, 'run'>;
  personaRegistry: Pick<PersonaRegistry, 'load'>;
  resolveCwd: () => Promise<string>;
  /** 发起委派的宿主会话；作为子任务的 parentSessionId 与事件过滤键。 */
  sessionId: string;
};

const DelegateParams = Type.Object(
  {
    to: Type.Union(
      [Type.String({ minLength: 1 }), Type.Array(Type.String({ minLength: 1 }), { minItems: 1, maxItems: 5 })],
      { description: '目标 persona 的 id；传数组可并行委派多路（如多角度审查）' }
    ),
    brief: Type.String({ minLength: 1, description: '任务简报：要求子任务做什么' }),
    text: Type.Optional(Type.String({ description: '待处理的正文文本（如需审查的段落）' }))
  },
  { additionalProperties: false }
);

/** 可委派对象：启用的 task 型且声明了输出 schema 的 persona。 */
function listDelegatablePersonas(personas: PersonaDefinition[]): PersonaDefinition[] {
  return personas.filter(
    persona => persona.execution === 'task' && persona.enabled !== false && Boolean(persona.output)
  );
}

function renderPersonaList(personas: PersonaDefinition[]): string {
  if (personas.length === 0) {
    return '（当前没有可委派的 persona）';
  }

  return personas.map(persona => `- ${persona.id}（${persona.name}）`).join('\n');
}

/** 若结构化输出携带字符串 summary 字段则提取；parent 只回摘要不转述全文。 */
function extractSummary(output: unknown): string | undefined {
  if (typeof output === 'object' && output !== null && 'summary' in output) {
    const summary = (output as { summary: unknown }).summary;
    return typeof summary === 'string' ? summary : undefined;
  }

  return undefined;
}

/** 把单路子任务终态渲染为回给模型的文本；结果正文只给 outputRef 引用，不内联。 */
function renderResultText(state: string, outcome: TaskRunResult | undefined, error: string | undefined): string {
  if (outcome?.status === 'success') {
    const summary = extractSummary(outcome.output);
    return [
      `子任务完成（runId: ${outcome.runId}）。`,
      `结构化结果已落盘：${outcome.outputRef}（作者可在界面查看，无需复述全文）。`,
      ...(summary ? [`摘要：${summary}`] : [])
    ].join('\n');
  }

  if (outcome?.status === 'failed') {
    return [
      `子任务执行完毕但输出未通过校验（runId: ${outcome.runId}）：`,
      ...outcome.errors.map(item => `- ${item}`),
      `原始输出已落盘：${outcome.outputRef}。`
    ].join('\n');
  }

  if (state === 'timeout') {
    return '子任务超时，已被终止。可换更小的输入或简化简报后重试。';
  }

  if (state === 'cancelled' || outcome?.status === 'cancelled') {
    return '子任务已被取消。';
  }

  return `子任务失败：${error ?? '未知错误'}`;
}

/** 多路 gather 的汇总行：每路只回状态与落盘引用，不带摘要——parent 不得聚合/复述各路结果。 */
function renderGatherLine(
  personaId: string,
  state: string,
  outcome: TaskRunResult | undefined,
  error: string | undefined
): string {
  if (outcome?.status === 'success') {
    return `- ${personaId}：完成（runId: ${outcome.runId}，结果：${outcome.outputRef}）`;
  }

  if (outcome?.status === 'failed') {
    return `- ${personaId}：输出未通过校验（runId: ${outcome.runId}，原始输出：${outcome.outputRef}）`;
  }

  if (state === 'timeout') {
    return `- ${personaId}：超时`;
  }

  if (state === 'cancelled' || outcome?.status === 'cancelled') {
    return `- ${personaId}：已取消`;
  }

  return `- ${personaId}：失败（${error ?? '未知错误'}）`;
}

type LaneResult = {
  requestId: string;
  personaId: string;
  state: string;
  outcome?: TaskRunResult;
  error?: string;
};

function laneDetails(lane: LaneResult) {
  return {
    requestId: lane.requestId,
    personaId: lane.personaId,
    state: lane.state,
    ...(lane.outcome && lane.outcome.status !== 'cancelled'
      ? { runId: lane.outcome.runId, outputRef: lane.outcome.outputRef }
      : {})
  };
}

/**
 * delegate 工具：把任务委派给 task 型 persona 在隔离子会话中执行；
 * to 传数组时 fan out 多路并行（gather），屏障等全部终态后汇总。
 *
 * description 里的 persona 枚举是会话创建时的快照；执行期重新加载校验，
 * 任一目标失效时整体拒绝并返回当前可用列表让模型自纠，避免部分执行的歧义。
 *
 * 分级为 readonly：子任务在无人值守闸门（ask 即拒）下运行且默认零工具，
 * 委派本身不产生需要用户确认的副作用。
 */
export async function createDelegateTool(context: DelegateToolContext): Promise<ToolDefinition<typeof DelegateParams>> {
  const cwd = await context.resolveCwd();
  const snapshot = listDelegatablePersonas((await context.personaRegistry.load(cwd)).personas);

  return {
    name: 'delegate',
    label: '委派子任务',
    description: [
      '把一项独立任务委派给专职 persona 在后台子会话中执行（如文本审查）。',
      '结果以结构化形式落盘并在界面展示，你只会收到状态与摘要——不要向作者复述结果全文。',
      '当前可委派的 persona：',
      renderPersonaList(snapshot)
    ].join('\n'),
    parameters: DelegateParams,
    riskLevel: 'readonly',
    execute: async (params, signal) => {
      const currentCwd = await context.resolveCwd();
      const available = listDelegatablePersonas((await context.personaRegistry.load(currentCwd)).personas);
      // 归一化为目标列表；同一 persona 重复出现时去重，避免无意义的重复子任务。
      const targetIds = [...new Set(Array.isArray(params.to) ? params.to : [params.to])];
      const targets: PersonaDefinition[] = [];
      const missing: string[] = [];

      for (const targetId of targetIds) {
        const persona = available.find(item => item.id === targetId);

        if (persona) {
          targets.push(persona);
        } else {
          missing.push(targetId);
        }
      }

      // 任一目标无效时整体拒绝：避免部分执行后模型对缺失路产生歧义。
      if (missing.length > 0) {
        return {
          text: [`persona 不可用：${missing.join('、')}。当前可委派的 persona：`, renderPersonaList(available)].join(
            '\n'
          )
        };
      }

      const lanes = targets.map(persona => ({ persona, requestId: randomUUID() }));
      // 宿主运行被中断时，通过池的取消路径统一终结全部子任务（立即释放槽位）。
      const onAbort = () => {
        for (const lane of lanes) {
          context.pool.cancel(lane.requestId);
        }
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        // 屏障：pool.run 以终态 resolve（不 reject），单路失败/取消不连带其余路。
        const results = await Promise.all(
          lanes.map(async (lane): Promise<LaneResult> => {
            const result = await context.pool.run({
              requestId: lane.requestId,
              personaId: lane.persona.id,
              sessionId: context.sessionId,
              execute: slotSignal =>
                context.taskRunner.run({
                  persona: lane.persona,
                  brief: params.brief,
                  text: params.text ?? '',
                  trigger: 'delegate',
                  parentSessionId: context.sessionId,
                  signal: slotSignal
                })
            });

            const laneResult: LaneResult = {
              requestId: lane.requestId,
              personaId: lane.persona.id,
              state: result.state
            };

            if (result.outcome) {
              laneResult.outcome = result.outcome;
            }

            if (result.error) {
              laneResult.error = result.error;
            }

            return laneResult;
          })
        );

        // 单路保持原有详细文本（含摘要）；多路每路只回状态+引用，防止 parent 聚合复述。
        const text =
          results.length === 1
            ? renderResultText(results[0].state, results[0].outcome, results[0].error)
            : [
                `已完成 ${results.length} 路并行子任务，各路结果已落盘并在界面分栏展示（无需复述全文）：`,
                ...results.map(lane => renderGatherLine(lane.personaId, lane.state, lane.outcome, lane.error))
              ].join('\n');

        return {
          text,
          details: { tasks: results.map(laneDetails) }
        };
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    }
  };
}
