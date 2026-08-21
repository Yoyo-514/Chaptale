import type { Static, TSchema } from 'typebox';

import type { RiskLevel } from '@chaptale/shared';

/** 工具执行结果：text 返回给模型，details 供日志或 UI 渲染使用。 */
export type ToolResult = {
  text: string;
  details?: unknown;
};

/**
 * 项目侧自定义工具契约。
 *
 * 有意不依赖模型 SDK 类型：工具的业务实现只关心 typebox 参数与文本结果，
 * 与具体 agent 运行时的对接放在 integrations 层的适配器完成。
 */
export type ToolDefinition<TParams extends TSchema = TSchema> = {
  /** 模型调用时使用的工具名。 */
  name: string;
  /** UI 展示用的短标签。 */
  label: string;
  /** 面向模型的功能描述。 */
  description: string;
  /** typebox 参数 schema。 */
  parameters: TParams;
  /** 权限风险分级；缺省按 mutating（需用户确认）保守处理。 */
  riskLevel?: RiskLevel;
  /**
   * 单次执行超时（毫秒）；缺省用装配层的统一默认值。
   *
   * 显式 `null` = 本工具自己管截止时间，引擎不再加一层。
   * delegate 就是这种：子任务池的单路超时上限 30 分钟且还要排队，
   * 外面再套一个固定值只会误杀正常的长任务。
   */
  timeoutMs?: number | null;
  execute(params: Static<TParams>, signal?: AbortSignal): Promise<ToolResult>;
};
