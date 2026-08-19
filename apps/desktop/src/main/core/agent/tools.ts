import { dynamicTool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';

import type { ToolDefinition } from '../tool-protocol/definition';
import { validateToolArguments } from '../tool-protocol/validation';
import type { PermissionGatePort } from './types';

/**
 * 项目工具协议 → AI SDK ToolSet。
 *
 * 参数：TypeBox 产物即标准 JSON Schema，经 jsonSchema() 直通（零 zod）；
 * 工具：dynamicTool——schema 在装配期运行时确定（定义来自 catalog 而非编译期字面量），
 * 入参不由 SDK 校验，因此在此层显式校验（见 tool-protocol/validation）；
 * 闸门：gate 存在且 riskLevel 非 readonly 时包装 execute——deny 返回模型可见的
 * 拒绝载荷（可改道）；显式 readonly 直行（风险分级事实源在 catalog）。
 *
 * 三者顺序固定为 **校验 → 闸门 → 执行**：
 * 参数非法时不该拿授权卡片打扰用户；闸门看到的必须是真正会被执行的收编后参数，
 * 否则参数级权限规则匹配的是一份与执行不一致的快照。
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
  // 只有显式 readonly 才免闸门：riskLevel 缺省的契约是「按 mutating 保守处理」
  // （definition.ts），destructive 更不该绕过。
  const needsGate = Boolean(gate) && definition.riskLevel !== 'readonly';

  return dynamicTool({
    description: definition.description,
    inputSchema: jsonSchema(definition.parameters),
    execute: async (input, executionOptions) => {
      const checked = validateToolArguments(definition.name, definition.parameters, input ?? {});

      if (!checked.ok) {
        // 抛出而非返回：走 SDK 的 tool-error 通道，引擎据此落盘 isError 的配对结果，
        // 模型看到诊断后自行改正重发，工具卡片也能显示为失败。
        throw new Error(checked.message);
      }

      const args = checked.value as Record<string, unknown>;

      if (needsGate) {
        const decision = await gate!.check({
          sessionId,
          toolName: definition.name,
          riskLevel: definition.riskLevel ?? 'mutating',
          args,
          // 取消运行时挂起的授权要随之作废，否则本次执行会一直等到授权超时。
          ...(executionOptions?.abortSignal ? { signal: executionOptions.abortSignal } : {})
        });

        if (decision.outcome === 'deny') {
          return { denied: true, reason: decision.reason ?? '用户拒绝了本次操作' };
        }
      }

      return definition.execute(checked.value, executionOptions?.abortSignal);
    }
  });
}
