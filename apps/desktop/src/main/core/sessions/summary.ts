import type { ParsedSessionFile, SessionMessage, SessionSummary } from './entry';
import { buildReplay } from './replay';
import { getSessionScope } from './storage';

const PREVIEW_MAX_LENGTH = 80;

/**
 * 从解析结果推导列表项摘要（会话名/时间/leaf/预览/累计 token 与费用）。
 * 供 P2-d 的 SessionRepository.list() 组装；纯函数，无 IO。
 */
export function deriveSessionSummary(
  file: ParsedSessionFile,
  sessionDir: string,
  filePath: string
): SessionSummary & { path: string } {
  const replay = buildReplay(file);
  const name = findSessionName(file);
  const messages = replay.path.filter(entry => entry.type === 'message');
  const lastMessage = messages.at(-1);
  const lastMessagePayload = lastMessage?.type === 'message' ? lastMessage.message : undefined;
  const updatedAt = file.entries.at(-1)?.timestamp ?? file.header.timestamp;

  let totalTokens = 0;

  for (const entry of messages) {
    const usage = entry.message.role === 'assistant' ? entry.message.usage : undefined;

    if (usage) {
      totalTokens += usage.totalTokens;
    }
  }

  return {
    id: file.header.id,
    cwd: file.header.cwd,
    createdAt: file.header.timestamp,
    name,
    updatedAt,
    leafId: replay.leafId,
    messageCount: messages.length,
    lastMessagePreview: extractPreview(lastMessagePayload),
    totalTokens,
    scope: getSessionScope(sessionDir),
    path: filePath
  };
}

function findSessionName(file: ParsedSessionFile): string | undefined {
  for (let index = file.entries.length - 1; index >= 0; index -= 1) {
    const entry = file.entries[index];

    if (entry.type === 'session_info' && entry.name) {
      return entry.name;
    }
  }

  return undefined;
}

function extractPreview(message: SessionMessage | undefined): string | undefined {
  if (!message) {
    return undefined;
  }

  // tool 消息无 content 字段（载荷在 output），预览跳过。
  const text = contentToText('content' in message ? message.content : undefined);

  if (!text) {
    return undefined;
  }

  return text.length > PREVIEW_MAX_LENGTH ? `${text.slice(0, PREVIEW_MAX_LENGTH)}…` : text;
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') {
    return collapse(content);
  }

  if (Array.isArray(content)) {
    return collapse(
      content
        .map(part =>
          part && typeof part === 'object' && (part as { type?: string }).type === 'text'
            ? String((part as { text?: unknown }).text ?? '')
            : ''
        )
        .filter(Boolean)
        .join(' ')
    );
  }

  return '';
}
function collapse(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}
