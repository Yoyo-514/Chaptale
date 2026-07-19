import type { PersonaDefinition } from '@chaptale/shared';

/** task 执行规格：由 persona 定义派生的、与 pi 无关的执行参数。 */
export type TaskPersonaSpec = {
  personaId: string;
  /** persona 正文，即 task session 的系统提示词。 */
  systemPrompt: string;
  /** 工具白名单子集；[] = 纯分析零工具（审查类）。 */
  tools: string[];
  /**
   * 模型偏好：具体 "provider/modelId"；fast/quality 的成本护栏映射尚未实现，
   * 当前除显式 id 外一律跟随全局默认。undefined = 全局默认。
   */
  modelPreference?: string;
};

/**
 * 从 persona 定义派生 task 执行规格。
 *
 * 仅接受 execution=task 且 enabled 的 persona——chat 型走主对话链路，
 * 在类型入口处挡住误用，而不是靠调用方自觉。
 */
export function resolveTaskSpec(persona: PersonaDefinition): TaskPersonaSpec {
  if (persona.execution !== 'task') {
    throw new Error(`persona 不是 task 型，无法作为子任务执行：${persona.id}`);
  }

  if (persona.enabled === false) {
    throw new Error(`persona 已停用：${persona.id}`);
  }

  return {
    personaId: persona.id,
    systemPrompt: persona.body,
    // 未声明 tools 视为纯分析（最小权限默认）；显式声明才开工具。
    tools: persona.tools ?? [],
    ...(persona.model?.preference ? { modelPreference: persona.model.preference } : {})
  };
}
