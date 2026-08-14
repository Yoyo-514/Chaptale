import type { ChatMessage } from '@chaptale/shared';

/**
 * AI SDK fullStream part → UI ChatMessage 的聚合翻译层。
 *
 * 策略（与 UI 现有渲染粒度对齐，协议零改动）：
 * - tool-call / tool-result：整条立即推送（UI 的 ToolCallRequest/Result 卡片）；
 * - text-delta：聚合成 partial assistant（stopReason 缺省），finish-step 时定稿推送；
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
    if (text === '' && reasoning === '' && toolCalls.length === 0) {
      return;
    }

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
          text += (part as { text: string }).text;
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

          toolCalls.push({
            type: 'toolCall',
            id: call.toolCallId,
            name: call.toolName,
            arguments: (call.input ?? {}) as Record<string, unknown>
          });
          break;
        }

        case 'tool-result': {
          // 工具结果先于本步 assistant 定稿推送（调用卡片紧贴其后）。
          const result = part as {
            toolCallId: string;
            toolName: string;
            output?: unknown;
          };

          flushAssistant();
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
