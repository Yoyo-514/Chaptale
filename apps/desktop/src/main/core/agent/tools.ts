import { dynamicTool, jsonSchema } from 'ai';
import type { ToolSet } from 'ai';

import type { ToolDefinition } from '../tool-protocol/definition';
import { validateToolArguments } from '../tool-protocol/validation';
import { toModelToolOutput } from './tool-output';
import type { PermissionGatePort } from './types';

/**
 * 模型输出撞上 token 上限时，整批工具调用的作废理由（模型可见）。
 *
 * 截断只会打断批次里的某一个调用，其余调用的参数 JSON 看起来完全合法——
 * 但那份"合法"不可信：模型的意图在中途被砍断，照做等于执行一份半截的计划。
 * 创作场景下代价具体而不可逆：协调好的多章改写只落地了前半段，文件停在中间状态。
 */
export const TRUNCATED_OUTPUT_MESSAGE =
  '本轮模型输出被 token 上限截断，同批工具调用已整体作废，一个都没有执行。请把改动拆小后重发完整的工具调用。';

export type ToolAssemblyOptions = {
  sessionId: string;
  gate?: PermissionGatePort;
  /**
   * 本轮模型输出是否被 token 上限截断。
   *
   * 由引擎在 `onLanguageModelCallEnd` 置位——SDK 把整批工具的执行推迟到
   * `model-call-end`，那正好在该回调之后，所以这是唯一一个"还来得及拦住"的时点。
   * 等到 fullStream 的 finish part 时，工具早已跑完。
   */
  isOutputTruncated?: () => boolean;
};

/**
 * 项目工具协议 → AI SDK ToolSet。
 *
 * 参数：TypeBox 产物即标准 JSON Schema，经 jsonSchema() 直通（零 zod）；
 * 工具：dynamicTool——schema 在装配期运行时确定（定义来自 catalog 而非编译期字面量），
 * 入参不由 SDK 校验，因此在此层显式校验（见 tool-protocol/validation）；
 * 闸门：gate 存在且 riskLevel 非 readonly 时包装 execute——deny 返回模型可见的
 * 拒绝载荷（可改道）；显式 readonly 直行（风险分级事实源在 catalog）。
 *
 * 顺序固定为 **截断 → 校验 → 闸门 → 执行**：
 * 已判定作废的批次不必再校验参数、更不该拿授权卡片打扰用户；闸门看到的必须是
 * 真正会被执行的收编后参数，否则参数级权限规则匹配的是一份与执行不一致的快照。
 */
export function toAiSdkTools(definitions: ToolDefinition[], options: ToolAssemblyOptions): ToolSet {
  const tools: ToolSet = {};

  for (const definition of definitions) {
    tools[definition.name] = createGatedTool(definition, options);
  }

  return tools;
}

function createGatedTool(definition: ToolDefinition, options: ToolAssemblyOptions) {
  const { sessionId, gate, isOutputTruncated } = options;
  // 只有显式 readonly 才免闸门：riskLevel 缺省的契约是「按 mutating 保守处理」
  // （definition.ts），destructive 更不该绕过。
  const needsGate = Boolean(gate) && definition.riskLevel !== 'readonly';

  return dynamicTool({
    description: definition.description,
    inputSchema: jsonSchema(definition.parameters),
    execute: async (input, executionOptions) => {
      if (isOutputTruncated?.()) {
        // 抛出而非返回：与参数校验失败同一条通道，落盘 isError 的配对结果，
        // 会话保持自洽，模型看到理由后可以拆小重发。
        throw new Error(TRUNCATED_OUTPUT_MESSAGE);
      }

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
    },
    // 模型通道入口：SDK 在构建下一轮请求消息时经此把 execute 原始返回值
    // 转成模型可见的输出（token 预算截断 + details 隔离）。落盘与 UI 走的
    // fullStream tool-result part 仍是原始返回值，完整内容不受影响。
    toModelOutput: ({ output }) => toModelToolOutput(output, false)
  });
}
