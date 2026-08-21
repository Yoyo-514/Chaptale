import type { ChatMessage } from '@chaptale/shared';
import { errorToMessage } from '@chaptale/shared';

import { parsePartialJsonObject } from '../../core/agent/partial-json';

/**
 * AI SDK fullStream part → UI ChatMessage 的聚合翻译层。
 *
 * 策略（与 UI 现有渲染粒度对齐，协议零改动）：
 * - text-delta：**增量**推送 partial assistant（UI 侧 pushText 是追加语义），
 *   同时本地聚合，finish-step 时以全量定稿覆盖那条 partial；
 * - reasoning-delta：推送累计**快照**（UI 侧 replaceReasoning 是覆盖语义）；
 * - tool-input-start / delta：工具名一到就亮卡片，参数边生成边填（见下）；
 * - tool-call：参数解析完毕，以权威值覆盖同 ID 的卡片；
 * - tool-result / tool-error：整条立即推送（assistant 卡片已在更早时候推送）；
 * - 其余 part（start/finish/abort 等）不产生 UI 消息。
 *
 * `error` part 不在此翻译：provider 故障由引擎抛出，经 IPC 的 `{status:'failed'}`
 * 走错误通道，避免同一次失败在聊天流与运行终态里各出现一次。
 *
 * step 边界即消息边界：连续 text-delta 属于同一条 assistant 消息。
 */

/**
 * 参数预览的重解析步长（字符）。
 *
 * 一章正文会产生上千个 delta，每个都全量重解析是 O(n²)。主参数（path/url/query）
 * 通常在头几十个字符里就完整了，步长对"卡片多快显示出正在动哪个文件"几乎无影响。
 */
const PARTIAL_ARGS_PARSE_STRIDE = 64;

export type PartTranslator = {
  consume(part: unknown): void;
};

export function createPartTranslator(emit: (message: ChatMessage) => void): PartTranslator {
  let text = '';
  let reasoning = '';
  let toolCalls: Array<{ type: 'toolCall'; id: string; name: string; arguments: Record<string, unknown> }> = [];
  let usage: { inputTokens: number; outputTokens: number; totalTokens: number } | undefined;
  /** 本步正在流式生成参数的工具调用。 */
  let pendingInputs = new Map<string, { name: string; raw: string; parsedAt: number }>();

  const emitToolCall = (invocation: { id: string; name: string; arguments: Record<string, unknown> }) => {
    const existing = toolCalls.findIndex(call => call.id === invocation.id);

    if (existing >= 0) {
      toolCalls[existing] = { type: 'toolCall', ...invocation };
    } else {
      toolCalls.push({ type: 'toolCall', ...invocation });
    }

    // 只带本次调用：UI 按调用 ID 更新，带全量会重复渲染已有调用。
    emit({
      role: 'assistant',
      toolCalls: [invocation],
      partial: true,
      timestamp: Date.now()
    } as ChatMessage);
  };

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
    pendingInputs = new Map();
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

        case 'tool-input-start': {
          // 工具名一到就亮卡片：写一整章时，参数要流很久才结束，
          // 等 tool-call 才亮意味着作者要对着静止的界面等上千个 token。
          const start = part as { id: string; toolName: string };

          pendingInputs.set(start.id, { name: start.toolName, raw: '', parsedAt: 0 });
          emitToolCall({ id: start.id, name: start.toolName, arguments: {} });
          break;
        }

        case 'tool-input-delta': {
          const chunk = part as { id: string; delta: string };
          const pending = pendingInputs.get(chunk.id);

          if (!pending) {
            break;
          }

          pending.raw += chunk.delta;

          // 并行批次跳过参数预览：渲染层对"最后一条 partial"是整体替换语义，
          // 逐个刷新会让先到的卡片在另一个调用流参数期间一直消失。
          if (pendingInputs.size > 1 || pending.raw.length - pending.parsedAt < PARTIAL_ARGS_PARSE_STRIDE) {
            break;
          }

          pending.parsedAt = pending.raw.length;
          const preview = parsePartialJsonObject(pending.raw);

          if (preview) {
            emitToolCall({ id: chunk.id, name: pending.name, arguments: preview });
          }

          break;
        }

        case 'tool-call': {
          const call = part as { toolCallId: string; toolName: string; input?: unknown };

          // 参数解析完毕：以权威值覆盖流式预览（预览是补齐出来的，可能少字段）。
          pendingInputs.delete(call.toolCallId);
          emitToolCall({
            id: call.toolCallId,
            name: call.toolName,
            arguments: (call.input ?? {}) as Record<string, unknown>
          });
          break;
        }

        case 'tool-result': {
          // assistant 卡片已在 tool-call 时推送；此处只补结果，assistant 定稿留给 finish-step（usage 随之）。
          const result = part as {
            toolCallId: string;
            toolName: string;
            output?: unknown;
            isError?: boolean;
          };

          emit({
            role: 'tool',
            toolCallId: result.toolCallId,
            toolName: result.toolName,
            output: result.output,
            ...(result.isError === true ? { isError: true } : {}),
            timestamp: Date.now()
          });
          break;
        }

        case 'tool-error': {
          // 与 tool-result 同等推送：缺了这条，工具卡片会永远停在"执行中"，
          // 且本轮 assistant 定稿后再无任何消息说明它为什么没有结果。
          const failure = part as {
            toolCallId: string;
            toolName: string;
            error?: unknown;
          };

          emit({
            role: 'tool',
            toolCallId: failure.toolCallId,
            toolName: failure.toolName,
            output: `工具执行失败：${errorToMessage(failure.error)}`,
            isError: true,
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
