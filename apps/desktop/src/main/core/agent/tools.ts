import { dynamicTool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';

import type { ToolDefinition } from '../tool-protocol/definition';
import type { PermissionGatePort } from './types';

/**
 * 项目工具协议 → AI SDK ToolSet。
 *
 * 参数：TypeBox 产物即标准 JSON Schema，经 jsonSchema() 直通（零 zod）；
 * 工具：dynamicTool——schema 在装配期运行时确定（定义来自 catalog 而非编译期字面量），
 * execute 入参为 unknown，由 definition.parameters 的静态类型在调用侧收窄；
 * 闸门：gate 存在且 riskLevel = mutating 时包装 execute——deny 返回模型可见的
 * 拒绝载荷（可改道）；readonly 直行（风险分级事实源在 catalog）。
 */
export function toAiSdkTools(
  definitions: ToolDefinition[],
  options: { sessionId: string; gate?: PermissionGatePort }
): ToolSet {
  const tools: ToolSet = {};

  for (const definition of definitions) {
    tools[definition.name] = createGatedTool(definition, options);
  }

  return tools;
}

function createGatedTool(definition: ToolDefinition, options: { sessionId: string; gate?: PermissionGatePort }) {
  const { sessionId, gate } = options;
  const needsGate = Boolean(gate) && definition.riskLevel === 'mutating';

  return dynamicTool({
    description: definition.description,
    inputSchema: jsonSchema(definition.parameters),
    execute: async (input, executionOptions) => {
      const args = (input ?? {}) as Record<string, unknown>;

      if (needsGate) {
        const decision = await gate!.check({
          sessionId,
          toolName: definition.name,
          riskLevel: definition.riskLevel!,
          args
        });

        if (decision.outcome === 'deny') {
          return { denied: true, reason: decision.reason ?? '用户拒绝了本次操作' };
        }
      }

      return definition.execute(args as never, executionOptions?.abortSignal);
    }
  });
}
