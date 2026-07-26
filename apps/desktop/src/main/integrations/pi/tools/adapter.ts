import type { ToolDefinition as PiToolDefinition } from '@earendil-works/pi-coding-agent';

import type { ToolDefinition } from '../../../core/tool-protocol/definition';

/**
 * 把项目侧工具定义适配为 pi 的自定义工具。
 *
 * 两侧参数都是 typebox schema，直接透传；执行结果统一折叠为单条文本内容，
 * details 原样携带供日志与 UI 使用。业务工具因此无需感知模型 SDK 类型。
 */
export function toPiToolDefinition(tool: ToolDefinition): PiToolDefinition {
  return {
    name: tool.name,
    label: tool.label,
    description: tool.description,
    parameters: tool.parameters,
    execute: async (_toolCallId, params, signal) => {
      const result = await tool.execute(params, signal);

      return {
        content: [{ type: 'text', text: result.text }],
        details: result.details
      };
    }
  };
}
