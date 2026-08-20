import { stepCountIs, streamText } from 'ai';

import { errorToMessage } from '@chaptale/shared';

import type { ResolvedModel } from '../models/runtime';
import type { SessionMessage } from '../sessions/entry';
import { INTERRUPTED_TOOL_RESULT_TEXT } from '../sessions/tool-pairing';
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
 *
 * **错误即值**：AI SDK 不抛异常，失败以 `error` / `tool-error` 两类 part 出现。
 * 两者都必须有分支——漏掉 `tool-error` 会落盘出没有配对结果的 tool_call，
 * 该会话此后每次请求都被 `AI_MissingToolResultsError` 挡在网络层之前；
 * 漏掉 `error` 则 provider 故障（401/429/500/断网）被静默吞掉、运行报告成功。
 *
 * **截断即作废**：模型输出撞 token 上限时整批工具调用一个都不执行（见 tools.ts）。
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
  let outputTruncated = false;

  const result = streamText({
    model: model.model,
    system,
    messages: toModelMessages(messages),
    tools: toAiSdkTools(tools, { sessionId, gate, isOutputTruncated: () => outputTruncated }),
    stopWhen: stepCountIs(maxSteps),
    abortSignal,
    // 模型响应解析完毕、任何工具执行开始前触发。SDK 把整批工具推迟到 model-call-end
    // 才一起执行，而该回调正好在其之前——这是唯一还来得及拦下截断批次的时点，
    // fullStream 的 finish part 到达时工具早已跑完。每次模型调用重新置位，不会残留。
    onLanguageModelCallEnd: event => {
      outputTruncated = event.finishReason === 'length';
    },
    // 模型级参数：未配置时不传，交由服务端默认（temperature/topP 仅 OpenAI 兼容系生效，其余协议忽略）。
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.topP !== undefined ? { topP: model.topP } : {})
  });

  let aborted = false;
  let finishReason = 'unknown';
  let totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let streamError: unknown;

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
          // 保留 SDK 的失败标记（该字段在结果 part 上可缺省）。
          isError: 'isError' in part ? part.isError === true : false
        });
      } else if (part.type === 'tool-error') {
        // 与 tool-result 同等落盘：工具失败也是一条结果，缺了它 tool_call 就悬空。
        // 触发面比"工具自己抛错"宽——模型调用不存在的工具、参数 JSON 被 token
        // 上限截断导致 SDK 拒绝执行，走的都是这条。
        stepToolResults.push({
          toolCallId: part.toolCallId,
          toolName: part.toolName,
          output: `工具执行失败：${errorToMessage(part.error)}`,
          isError: true
        });
      } else if (part.type === 'error') {
        // provider 故障（401/429/500/断网）与 SDK 前置校验失败都走这里。
        // 不能就地抛：先跳出循环把已收集内容落盘，再由调用方感知失败。
        streamError = part.error;
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

  // 流异常中断时尽力落盘已收集内容（未配对的 tool call 在此补合成结果）。
  await persistStep();

  // 取消是用户意图，不算失败；其余 error part 必须以异常抵达调用方，
  // 否则 IPC 会发出 { status: 'completed' } 而界面上什么都没有。
  if (streamError !== undefined && !aborted) {
    throw streamError instanceof Error ? streamError : new Error(errorToMessage(streamError));
  }

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
      withSyntheticResults(stepToolCalls, stepToolResults)
    );

    await onStepPersist(stepMessages);
    stepText = '';
    stepReasoning = '';
    stepToolCalls = [];
    stepToolResults = [];
    stepUsage = undefined;
  }
}

/**
 * 为没有结果的 tool call 补合成结果。
 *
 * 正常 step 里 SDK 保证 finish-step 前所有工具已结算，此函数是恒等的；
 * 真正生效的是中断路径：用户在工具执行途中点「停止」时流里只有 tool-call、
 * 没有 tool-result，而引擎仍会尽力落盘——不补就写出悬空 tool_call。
 *
 * 写入侧与读取侧（`core/sessions/tool-pairing.ts`）两道都要有：读取侧能救活
 * 已经写坏的历史，写入侧保证文件本身自洽——历史面板与 HTML 导出直接读 entry，
 * 不经上下文投影。
 */
export function withSyntheticResults(
  toolCalls: { id: string; name: string }[],
  results: ToolResultRecord[]
): ToolResultRecord[] {
  if (toolCalls.length === 0) {
    return results;
  }

  const settled = new Set(results.map(result => result.toolCallId));
  const synthetic = toolCalls
    .filter(call => !settled.has(call.id))
    .map((call): ToolResultRecord => ({
      toolCallId: call.id,
      toolName: call.name,
      output: INTERRUPTED_TOOL_RESULT_TEXT,
      isError: true
    }));

  return synthetic.length > 0 ? [...results, ...synthetic] : results;
}

function normalizeUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0
  };
}
