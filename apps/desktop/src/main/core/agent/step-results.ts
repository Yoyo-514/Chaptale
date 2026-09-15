import type { ModelMessage } from 'ai';

import type { SessionMessage } from '../sessions/entry';
import { INTERRUPTED_TOOL_RESULT_TEXT } from '../sessions/tool-pairing';
import { stepRecordsToSessionMessages, toModelMessages } from './messages';
import { TRUNCATED_OUTPUT_MESSAGE } from './tools';
import type { AgentStepOutcome, ToolResultRecord } from './types';

type SyntheticResultCause = 'aborted' | 'output-truncated' | 'error';

const SYNTHETIC_RESULT_TEXTS = {
  aborted: INTERRUPTED_TOOL_RESULT_TEXT,
  'output-truncated': TRUNCATED_OUTPUT_MESSAGE,
  error: '工具未执行：本轮因错误中止。如果仍然需要这一步的结果，请重新发起调用。'
} satisfies Record<SyntheticResultCause, string>;

/** 写入侧补齐工具结果；读取侧另有历史修复，不能依赖回放来掩盖坏记录。 */
export function withSyntheticResults(
  toolCalls: { id: string; name: string }[],
  results: ToolResultRecord[],
  cause: SyntheticResultCause
): ToolResultRecord[] {
  if (toolCalls.length === 0) return results;

  const settled = new Set(results.map(result => result.toolCallId));
  const synthetic = toolCalls
    .filter(call => !settled.has(call.id))
    .map((call): ToolResultRecord => {
      const result: ToolResultRecord = {
        toolCallId: call.id,
        toolName: call.name,
        output: SYNTHETIC_RESULT_TEXTS[cause],
        isError: true
      };
      if (cause === 'aborted') result.interrupted = true;
      return result;
    });

  return synthetic.length ? [...results, ...synthetic] : results;
}

function resolveSyntheticCause(step: AgentStepOutcome): SyntheticResultCause {
  if (step.aborted) return 'aborted';
  if (step.error === undefined && step.finishReason === 'length') return 'output-truncated';
  return 'error';
}

/** 空步骤不落盘，但已收到的缓存用量和半截正文都必须保留。 */
export function toPersistedStep(step: AgentStepOutcome): SessionMessage[] {
  if (
    !step.text &&
    !step.reasoning &&
    !step.toolCalls.length &&
    !step.toolResults.length &&
    step.usage.totalTokens === 0 &&
    !step.usage.cache
  ) {
    return [];
  }

  return stepRecordsToSessionMessages(
    {
      text: step.text,
      ...(step.reasoning ? { reasoning: step.reasoning } : {}),
      toolCalls: step.toolCalls,
      usage: step.usage
    },
    withSyntheticResults(step.toolCalls, step.toolResults, resolveSyntheticCause(step))
  );
}

/** SDK 原始响应保留 reasoning 签名；只补缺失结果，不用落盘投影替代模型上下文。 */
export function withPairedToolResults(step: AgentStepOutcome): ModelMessage[] {
  if (step.toolCalls.length === 0) return step.responseMessages;

  const paired = new Set<string>();
  for (const message of step.responseMessages) {
    if (message.role !== 'tool') continue;
    for (const part of message.content) {
      if (part.type === 'tool-result') paired.add(part.toolCallId);
    }
  }

  const missing = withSyntheticResults(step.toolCalls, step.toolResults, resolveSyntheticCause(step)).filter(
    result => !paired.has(result.toolCallId)
  );
  if (!missing.length) return step.responseMessages;

  return [
    ...step.responseMessages,
    ...toModelMessages(
      missing.map(result => ({
        role: 'tool' as const,
        toolCallId: result.toolCallId,
        toolName: result.toolName,
        output: result.output,
        isError: result.isError === true
      }))
    )
  ];
}
