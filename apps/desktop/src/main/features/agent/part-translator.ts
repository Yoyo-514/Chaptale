import type { ChatMessage } from '@chaptale/shared';

/**
 * AI SDK fullStream part → UI ChatMessage 的聚合翻译层。
 *
 * 策略（与 UI 现有渲染粒度对齐，协议零改动）：
 * - text-delta：**增量**推送 partial assistant（UI 侧 pushText 是追加语义），
 *   同时本地聚合，finish-step 时以全量定稿覆盖那条 partial；
 * - reasoning-delta：推送累计**快照**（UI 侧 replaceReasoning 是覆盖语义）；
 * - tool-call：立即推送带该调用的 partial assistant，让工具卡片在执行前就可见；
 *   只带本次调用（UI 按调用 ID 幂等更新，带全量会重复渲染已有调用）；
 * - tool-result：整条立即推送（assistant 卡片已在 tool-call 时先行推送）；
 * - 其余 part（start/finish/abort 等）不产生 UI 消息。
 *
 * step 边界即消息边界：连续 text-delta 属于同一条 assistant 消息。
 */

export type PartTranslator = {
  consume(part: unknown): void;
};

export function createPartTranslator(emit: (message: ChatMessage) => void): PartTranslator {
  let text = '';
  let reasoning = '';
  let toolCalls: Array<{ type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }> = [];
  let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;

  const flushAssistant = () => {
    if (text !== '' || reasoning !== '' || toolCalls.length > 0) {
      emit({
        role: 'assistant',
        content: text === '' ? undefined : text,
        ...(reasoning ? { reasoning } : {}),
        ...(toolCalls.length > 0
          ? { toolCalls: toolCalls.map(call => ({ id: call.id, name: call.name, arguments: call.arguments })) }
          : {}),
        ...(usage ? { usage } : {}),
        partial: false,
        timestamp: Date.now()
      } as ChatMessage);
    }

    // 无载荷时同样清空 usage：否则本步 usage 会泄漏到下一步的定稿消息上。
    text = '';
    reasoning = '';
    toolCalls = [];
    usage = undefined;
  };

  return {
    consume(part: unknown) {
      const record = part as { type?: string };

      switch (record?.type) {
        case 'text-delta': {
          const delta = (part as { text: string }).text;

          if (!delta) {
            break;
          }

          text += delta;
          // 增量推送：UI 的 pushText 是追加语义，此处必须发 delta 而非累计快照。
          emit({
            role: 'assistant',
            content: delta,
            partial: true,
            timestamp: Date.now()
          } as ChatMessage);
          break;
        }

        case 'reasoning-delta': {
          // fullStream part 属性是 text；UI 收到累计快照（partial 语义）。
          reasoning += (part as { text: string }).text;
          emit({
            role: 'assistant',
            content: '',
            reasoning,
            partial: true,
            timestamp: Date.now()
          } as ChatMessage);
          break;
        }

        case 'tool-call': {
          const call = part as { toolCallId: string; toolName: string; input?: unknown };
          const invocation = {
            id: call.toolCallId,
            name: call.toolName,
            arguments: (call.input ?? {}) as Record<string, unknown>
          };

          toolCalls.push({ type: 'toolCall', ...invocation });
          // 工具执行前先亮卡片；只带本次调用，UI 按调用 ID 幂等更新（带全量会重复渲染已有调用）。
          emit({
            role: 'assistant',
            toolCalls: [invocation],
            partial: true,
            timestamp: Date.now()
          } as ChatMessage);
          break;
        }

        case 'tool-result': {
          // assistant 卡片已在 tool-call 时推送；此处只补结果，assistant 定稿留给 finish-step（usage 随之）。
          const result = part as {
            toolCallId: string;
            toolName: string;
            output?: unknown;
          };

          emit({
            role: 'tool',
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            output: result.output,
            timestamp: Date.now()
          });
          break;
        }

        case 'finish-step': {
          const step = part as {
            usage?: { inputTokens?: number; outputTokens?: number; totalTokens?: number };
          };

          if (step.usage) {
            usage = {
              inputTokens: step.usage.inputTokens ?? 0,
              outputTokens: step.usage.outputTokens ?? 0,
              totalTokens: step.usage.totalTokens ?? 0
            };
          }

          flushAssistant();
          break;
        }

        default:
          break;
      }
    }
  };
}
