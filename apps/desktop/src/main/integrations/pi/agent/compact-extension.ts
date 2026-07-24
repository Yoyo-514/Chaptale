import type { InlineExtension, SessionBeforeCompactEvent } from '@earendil-works/pi-coding-agent';

import type { CompactCoord, CompactOutput, CompactReason } from '../../../modules/memory/compact-coord';
import { decodeMemoryMessage } from '../../../modules/memory/message-codec';

export type ChaptaleCompactDetails = {
  kind: 'chaptale-creative-checkpoint';
  schemaVersion: 1;
  checkpointId: string;
  summaryRef: string;
  distillerRunId: string;
  memoryRefs: string[];
};

type CompactExtOpts = {
  sessionId: string;
  cwd: string;
  coord: Pick<CompactCoord, 'run'>;
  onError?: (error: Error, reason: CompactReason) => void;
};

/**
 * 用 Chaptale 创作检查点覆盖 pi 摘要器；切点、会话树和上下文重建仍交给 pi。
 * handler 不能向外抛错：pi 会吞掉扩展异常并回退 native，因此失败必须显式 cancel。
 */
export function createCompactExt(opts: CompactExtOpts): InlineExtension {
  return {
    name: 'chaptale-creative-compact',
    hidden: true,
    factory: pi => {
      pi.on('session_before_compact', async (event, ctx) => {
        try {
          const checkpoint = await opts.coord.run({
            sessionId: opts.sessionId,
            cwd: opts.cwd,
            reason: event.reason,
            checkpointId: event.preparation.firstKeptEntryId,
            tokensBefore: event.preparation.tokensBefore,
            conversation: serializeMsgs(event.preparation.messagesToSummarize),
            turnPrefix: serializeMsgs(event.preparation.turnPrefixMessages),
            ...(event.preparation.previousSummary ? { previousSummary: event.preparation.previousSummary } : {}),
            maxInputTokens: getInputBudget(ctx.model?.contextWindow, event.preparation.settings.reserveTokens),
            signal: event.signal
          });

          return toPiResult(event, checkpoint);
        } catch (cause) {
          const error = cause instanceof Error ? cause : new Error(String(cause));
          try {
            opts.onError?.(error, event.reason);
          } catch {
            // 上报失败不能冲破 fail-closed 边界，否则 pi 会把 rejected handler 当成未覆盖并回退 native。
          }
          return { cancel: true };
        }
      });
    }
  };
}

function toPiResult(event: SessionBeforeCompactEvent, value: CompactOutput) {
  const details: ChaptaleCompactDetails = {
    kind: 'chaptale-creative-checkpoint',
    schemaVersion: 1,
    checkpointId: event.preparation.firstKeptEntryId,
    summaryRef: value.summaryRef,
    distillerRunId: value.runId,
    memoryRefs: value.memoryRefs
  };

  return {
    compaction: {
      summary: value.summary,
      firstKeptEntryId: event.preparation.firstKeptEntryId,
      tokensBefore: event.preparation.tokensBefore,
      details
    }
  };
}

/** 不复用 pi serializeConversation，避免其按 coding 场景截断长 tool result。 */
function serializeMsgs(messages: SessionBeforeCompactEvent['preparation']['messagesToSummarize']): string {
  return messages.map(serializeMsg).filter(Boolean).join('\n\n');
}

function serializeMsg(message: SessionBeforeCompactEvent['preparation']['messagesToSummarize'][number]): string {
  const role = message.role;
  const content = 'content' in message ? message.content : undefined;
  const blocks = Array.isArray(content) ? content : [];
  const parts: string[] = [];

  for (const block of blocks) {
    if (!block || typeof block !== 'object' || !('type' in block)) continue;

    if (block.type === 'text' && 'text' in block && typeof block.text === 'string') {
      parts.push(block.text);
    } else if (block.type === 'thinking' && 'thinking' in block && typeof block.thinking === 'string') {
      parts.push(`[思考]\n${block.thinking}`);
    } else if (block.type === 'toolCall' && 'name' in block) {
      const name = typeof block.name === 'string' ? block.name : 'unknown';
      const args = 'arguments' in block ? block.arguments : undefined;
      parts.push(`[工具调用] ${name}(${safeJson(args)})`);
    } else if (block.type === 'image') {
      parts.push('[图片内容未展开]');
    }
  }

  const rawText = typeof content === 'string' ? content : parts.join('\n');
  // 历史 user message 可能带旧 memory 信封；检查点另读最新快照，避免重复和固化过期数据。
  const text = role === 'user' ? decodeMemoryMessage(rawText).text : rawText;
  const label = role === 'user' ? '用户' : role === 'assistant' ? '助手' : role === 'toolResult' ? '工具结果' : role;
  return text.trim() ? `[${label}]\n${text.trim()}` : '';
}

function getInputBudget(contextWindow: number | undefined, reserveTokens: number): number {
  const window = contextWindow && contextWindow > 0 ? contextWindow : 64_000;
  const outputReserve = Math.min(Math.max(0, reserveTokens), Math.floor(window * 0.5));
  const protocolReserve = Math.min(8_000, Math.floor(window * 0.2));
  // 预算允许降到 0；固定 prompt 放不下时 TaskRunner fail-closed，不冒险提交超窗口请求。
  return Math.max(0, Math.min(120_000, window - outputReserve - protocolReserve));
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '[无法序列化]';
  }
}

export function isChaptaleCompactDetails(value: unknown): value is ChaptaleCompactDetails {
  if (!value || typeof value !== 'object') return false;
  const details = value as Partial<ChaptaleCompactDetails>;
  return (
    details.kind === 'chaptale-creative-checkpoint' &&
    details.schemaVersion === 1 &&
    typeof details.checkpointId === 'string' &&
    typeof details.summaryRef === 'string' &&
    typeof details.distillerRunId === 'string' &&
    Array.isArray(details.memoryRefs) &&
    details.memoryRefs.every(item => typeof item === 'string')
  );
}
