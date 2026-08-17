import type { PersonaDefinition } from '@chaptale/shared';

import type { ToolCatalog } from '../../core/tool-protocol/catalog';
import type { IndexDomain } from '../search/types';
import { resolveReadableIndexDomains } from './memory-access';

/** task 执行规格：由 persona 定义派生的执行参数。 */
export type TaskPersonaSpec = {
  personaId: string;
  /** persona 正文，即 task session 的系统提示词。 */
  systemPrompt: string;
  /** 工具白名单子集；[] = 纯分析零工具（审查类）。 */
  tools: string[];
  /** 只加载 persona 明确绑定的 skill，避免 task session 获得无关指令。 */
  skills: string[];
  /** persona 声明与角色类型安全上限求交后的可检索域。 */
  memoryReadDomains: IndexDomain[];
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
export function resolveTaskSpec(persona: PersonaDefinition, toolCatalog: ToolCatalog): TaskPersonaSpec {
  if (persona.execution !== 'task') {
    throw new Error(`persona 不是 task 型，无法作为子任务执行：${persona.id}`);
  }

  if (persona.enabled === false) {
    throw new Error(`persona 已停用：${persona.id}`);
  }

  const memoryReadDomains = resolveReadableIndexDomains(persona);
  const selected = toolCatalog.selectSessionTools(persona, 'task');
  // memory_search 同时要求工具声明与至少一个可读索引域，避免把未注册工具名传给 runtime。
  const tools = [...selected.builtinToolNames, ...selected.customToolNames].filter(
    tool => tool !== 'memory_search' || memoryReadDomains.length > 0
  );

  return {
    personaId: persona.id,
    systemPrompt: persona.body,
    // 未声明 tools/skills 均按最小能力处理；显式声明才注入。
    tools,
    skills: [...(persona.skills ?? [])],
    memoryReadDomains,
    ...(persona.model?.preference ? { modelPreference: persona.model.preference } : {})
  };
}
