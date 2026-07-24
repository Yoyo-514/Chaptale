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
    to: Type.String({ minLength: 1, description: '目标 persona 的 id' }),
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

/** 把子任务终态渲染为回给模型的文本；结果正文只给 outputRef 引用，不内联。 */
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

/**
 * delegate 工具：把任务委派给 task 型 persona 在隔离子会话中执行。
 *
 * description 里的 persona 枚举是会话创建时的快照；执行期重新加载校验，
 * 目标失效时返回当前可用列表让模型自纠，因此快照过期不会造成错误委派。
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
      const persona = available.find(item => item.id === params.to);

      if (!persona) {
        return {
          text: [`persona 不可用：${params.to}。当前可委派的 persona：`, renderPersonaList(available)].join('\n')
        };
      }

      const requestId = randomUUID();
      // 宿主运行被中断时，通过池的取消路径统一终结子任务（立即释放槽位）。
      const onAbort = () => context.pool.cancel(requestId);
      signal?.addEventListener('abort', onAbort, { once: true });

      try {
        const result = await context.pool.run({
          requestId,
          personaId: persona.id,
          sessionId: context.sessionId,
          execute: slotSignal =>
            context.taskRunner.run({
              persona,
              brief: params.brief,
              text: params.text ?? '',
              trigger: 'delegate',
              parentSessionId: context.sessionId,
              signal: slotSignal
            })
        });

        return {
          text: renderResultText(result.state, result.outcome, result.error),
          details: {
            requestId,
            personaId: persona.id,
            state: result.state,
            ...(result.outcome && result.outcome.status !== 'cancelled'
              ? { runId: result.outcome.runId, outputRef: result.outcome.outputRef }
              : {})
          }
        };
      } finally {
        signal?.removeEventListener('abort', onAbort);
      }
    }
  };
}
