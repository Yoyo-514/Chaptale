import type { Static, TObject } from 'typebox';

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
export type ToolDefinition<TParams extends TObject = TObject> = {
  /** 模型调用时使用的工具名。 */
  name: string;
  /** UI 展示用的短标签。 */
  label: string;
  /** 面向模型的功能描述。 */
  description: string;
  /**
   * typebox 参数 schema，根必须是 `Type.Object`。
   *
   * provider（OpenAI 兼容协议、Anthropic）要求 function 参数的 JSON Schema 根为 `type: "object"`；
   * 顶层 `Type.Union` 会编译成没有 type 的 `anyOf`，带上它的每一轮请求都会被整体拒收。
   * 「多选一」这类约束改用可选字段表达，在 execute 里校验。
   */
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
