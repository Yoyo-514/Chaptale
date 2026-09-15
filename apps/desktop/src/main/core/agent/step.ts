import { stepCountIs, streamText } from 'ai';
import type { ModelMessage } from 'ai';

import { errorToMessage, type TokenUsage } from '@chaptale/shared';

import { buildCachedPrompt, type PromptCacheMode } from '../models/prompt-cache';
import type { ResolvedModel } from '../models/runtime';
import { normalizeModelUsage } from '../models/token-usage';
import { IDLE_TIMEOUT, withIdleTimeout } from './idle-timeout';
import { toAiSdkTools } from './tools';
import type { AgentStepOutcome, PermissionGatePort, ToolResultRecord } from './types';

type AgentStepOptions = {
  sessionId: string;
  model: ResolvedModel;
  system: string;
  messages: ModelMessage[];
  tools: Parameters<typeof toAiSdkTools>[0];
  gate?: PermissionGatePort;
  onPart?: (part: unknown) => void;
  abortSignal?: AbortSignal;
  idleTimeoutMs: number;
  cacheMode?: PromptCacheMode;
  cacheScope?: string;
  contextPrefix?: string;
};

/** 一次模型调用与工具批次；只收集结果，不决定续跑，也不拥有会话存储。 */
export async function runAgentStep(options: AgentStepOptions): Promise<AgentStepOutcome> {
  const { sessionId, model, abortSignal, idleTimeoutMs } = options;
  let text = '';
  let reasoning = '';
  const toolCalls: AgentStepOutcome['toolCalls'] = [];
  const toolResults: ToolResultRecord[] = [];
  let usage: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
  let outputTruncated = false;
  let finishReason = 'unknown';
  let aborted = false;
  let streamError: unknown;
  const timeoutController = new AbortController();
  const signal = abortSignal ? AbortSignal.any([abortSignal, timeoutController.signal]) : timeoutController.signal;

  const result = streamText({
    model: model.model,
    ...buildCachedPrompt({
      policy: model.promptCachePolicy,
      mode: options.cacheMode,
      scope: options.cacheScope ?? sessionId,
      system: options.system,
      messages: options.messages,
      contextPrefix: options.contextPrefix
    }),
    tools: toAiSdkTools(options.tools, { sessionId, gate: options.gate, isOutputTruncated: () => outputTruncated }),
    stopWhen: stepCountIs(1),
    abortSignal: signal,
    // 必须在工具批次执行之前判定截断；聚合 finish part 到达时已经太晚。
    onLanguageModelCallEnd: event => {
      outputTruncated = event.finishReason === 'length';
      finishReason = event.finishReason;
      usage = normalizeModelUsage(event.usage);
    },
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.topP !== undefined ? { topP: model.topP } : {}),
    ...(model.reasoningEffort !== undefined ? { reasoning: model.reasoningEffort } : {})
  });

  try {
    for await (const part of withIdleTimeout(result.stream, idleTimeoutMs)) {
      if (part === IDLE_TIMEOUT) {
        streamError = new Error(
          `模型接了连接但 ${Math.round(idleTimeoutMs / 1000)} 秒内没有再返回内容（stream idle timeout）`
        );
        // return() 不能打断尚未完成的 next()，必须同时取消底层请求和工具。
        timeoutController.abort(streamError);
        break;
      }

      options.onPart?.(part);

      switch (part.type) {
        case 'text-delta':
          text += part.text;
          break;
        case 'reasoning-delta':
          reasoning += part.text;
          break;
        case 'tool-call':
          toolCalls.push({
            id: part.toolCallId,
            name: part.toolName,
            arguments: (part.input ?? {}) as Record<string, unknown>
          });
          break;
        case 'tool-result':
          toolResults.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
            isError: 'isError' in part ? part.isError === true : false
          });
          break;
        case 'tool-error':
          toolResults.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: `工具执行失败：${errorToMessage(part.error)}`,
            isError: true
          });
          break;
        case 'error':
          streamError = part.error;
          break;
        case 'finish-step':
          usage = normalizeModelUsage(part.usage);
          break;
        case 'abort':
          aborted = true;
          break;
      }
    }
  } catch (error) {
    if (abortSignal?.aborted) aborted = true;
    else streamError = error;
  }

  let responseMessages: ModelMessage[] = [];
  if (streamError === undefined && !aborted) {
    try {
      responseMessages = await result.responseMessages;
    } catch (error) {
      streamError = error;
    }
  }

  return {
    text,
    reasoning,
    toolCalls,
    toolResults,
    usage,
    finishReason,
    aborted,
    error: streamError,
    responseMessages
  };
}
