import { stepCountIs, streamText } from 'ai';

import type { ResolvedModel } from '../models/runtime';
import type { SessionMessage } from '../sessions/entry';
import { stepRecordsToSessionMessages, toModelMessages } from './messages';
import { toAiSdkTools } from './tools';
import type { AgentStreamEnvelope, PermissionGatePort, ToolResultRecord } from './types';

export type RunAgentLoopOptions = {
  sessionId: string;
  model: ResolvedModel;
  /** 系统提示词（composeSystemPrompt 产物，装配层注入）。 */
  system: string;
  /** 回放产物（store.buildContextMessages()）。 */
  messages: SessionMessage[];
  tools: Parameters<typeof toAiSdkTools>[0];
  gate?: PermissionGatePort;
  /** step 边界落盘回调；缺省不落盘（测试用）。 */
  onStepPersist?: (messages: SessionMessage[]) => Promise<void>;
  /** 事件透传回调（IPC 信封已在调用方组装或此处直传 part）。 */
  onPart?: (envelope: AgentStreamEnvelope) => void;
  abortSignal?: AbortSignal;
  /** 安全上限；正常由无 tool call 自然停止。 */
  maxSteps?: number;
};

export type AgentLoopResult = {
  finishReason: string;
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  aborted: boolean;
};

/**
 * Agent 主循环：streamText 驱动，多步工具链由 AI SDK 内置。
 *
 * 事件透传：fullStream part → onPart 原样转发（{sessionId, seq, part} 信封）；
 * 落盘：引擎在 finish-step 边界把本轮 assistant + tool 结果交 onStepPersist
 * （收集器自聚合，不依赖 SDK 内部聚合时序）；崩溃丢失上限 = 当前 step。
 */
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const {
    sessionId,
    model,
    system,
    messages,
    tools,
    gate,
    onStepPersist,
    onPart,
    abortSignal,
    maxSteps = 32
  } = options;

  let seq = 0;
  let stepText = '';
  let stepReasoning = '';
  let stepToolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
  let stepToolResults: ToolResultRecord[] = [];
  let stepUsage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

  const result = streamText({
    model: model.model,
    system,
    messages: toModelMessages(messages),
    tools: toAiSdkTools(tools, { sessionId, gate }),
    stopWhen: stepCountIs(maxSteps),
    abortSignal,
    // 模型级参数：未配置时不传，交由服务端默认（temperature/topP 仅 OpenAI 兼容系生效，其余协议忽略）。
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.topP !== undefined ? { topP: model.topP } : {})
  });

  let aborted = false;
  let finishReason = 'unknown';
  let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  try {
    for await (const part of result.fullStream) {
      onPart?.({ sessionId, seq: seq++, part });

      if (part.type === 'text-delta') {
        stepText += part.text;
      } else if (part.type === 'reasoning-delta') {
        // fullStream 的 TextStreamReasoningDeltaPart 属性是 text（UIMessage chunk 才是 delta）。
        stepReasoning += part.text;
      } else if (part.type === 'tool-call') {
        stepToolCalls.push({
          id: part.toolCallId,
          name: part.toolName,
          arguments: (part.input ?? {}) as Record<string, unknown>
        });
      } else if (part.type === 'tool-result') {
        stepToolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: part.output,
          // 保留 SDK 的失败标记（部分 SDK 版本该字段在结果 part 上可缺省）。
          isError: 'isError' in part ? part.isError === true : false
        });
      } else if (part.type === 'finish-step') {
        stepUsage = normalizeUsage(part.usage);
        await persistStep();
      } else if (part.type === 'finish') {
        finishReason = part.finishReason;
        totalUsage = normalizeUsage(part.totalUsage);
      } else if (part.type === 'abort') {
        aborted = true;
      }
    }
  } catch (error) {
    if (!abortSignal?.aborted) {
      throw error;
    }

    aborted = true;
  }

  // 流异常中断时尽力落盘已收集内容。
  await persistStep();

  return { finishReason, totalUsage, aborted };

  async function persistStep(): Promise<void> {
    if (!onStepPersist) {
      return;
    }

    if (!stepText && !stepReasoning && stepToolCalls.length === 0 && stepToolResults.length === 0) {
      return;
    }

    const stepMessages = stepRecordsToSessionMessages(
      {
        text: stepText,
        ...(stepReasoning ? { reasoning: stepReasoning } : {}),
        toolCalls: stepToolCalls,
        usage: stepUsage
      },
      stepToolResults
    );

    await onStepPersist(stepMessages);
    stepText = '';
    stepReasoning = '';
    stepToolCalls = [];
    stepToolResults = [];
    stepUsage = undefined;
  }
}

function normalizeUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0
  };
}
