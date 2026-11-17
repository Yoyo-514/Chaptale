import type { SessionManager } from '@earendil-works/pi-coding-agent';

import type { AgentInstructions, ChatMessage, EditMode, ReadonlyHistory } from '../protocol/index.ts';
import { type DamagedHistory, readDamagedHistory } from '../session/session-storage.ts';
import { messageView, type SdkMessage, transcriptView } from './message-view.ts';
import { sessionRecords } from './session-tree.ts';

/** 打开历史的结论：完整历史可继续对话；损坏或缺少记录的只能查看。 */
export type SessionHistory =
  | { kind: 'live'; instructions: AgentInstructions; mode: EditMode }
  | { kind: 'readonly'; sessionId: string | null; name?: string; readonly: ReadonlyHistory; messages: ChatMessage[] };

const readonlyMessages = {
  incomplete: '缺少指令或修改模式记录，对话不完整，只能查看，不能继续',
  invalid: '指令或修改模式记录无效，只能查看，不能继续；原文件未修改',
  damaged: '会话历史部分损坏，只能查看，不能继续；原文件未修改'
};

/** 损坏历史按文件顺序显示能识别的消息，其余行计入坏行。 */
function damagedMessages(history: DamagedHistory): { messages: ChatMessage[]; lines: number[] } {
  const messages: ChatMessage[] = [];
  const lines = [...history.damagedLines];
  for (const { line, value } of history.entries) {
    if (value.type !== 'message') continue;
    // SAFETY: 下面确认 role 与 content 的形状后才交给 messageView；它只读取这些字段及可选的 toolName/isError/stopReason/errorMessage。
    const message = value.message as SdkMessage | null;
    const content: unknown = message && 'content' in message ? message.content : undefined;
    const valid =
      typeof message?.role === 'string' &&
      (content === undefined ||
        typeof content === 'string' ||
        (Array.isArray(content) && content.every(block => typeof block?.type === 'string')));
    if (valid) messages.push(messageView(message));
    else lines.push(line);
  }
  // lines 是本函数内的副本，原地排序不影响调用方；当前 lib 不提供 toSorted。
  return { messages, lines: lines.sort((a, b) => a - b) };
}

function readonlyFrom(manager: SessionManager, reason: ReadonlyHistory['reason'], message: string): SessionHistory {
  const messages = transcriptView(manager);
  return {
    kind: 'readonly',
    sessionId: manager.getSessionId(),
    name: manager.getSessionName(),
    readonly: { reason, message, lines: [] },
    messages
  };
}

/** 根据会话池已读取的历史判定能否继续；不创建 AgentSession，不修复、不写入原文件。 */
export function sessionHistory(manager: SessionManager): SessionHistory {
  let records: ReturnType<typeof sessionRecords>;
  try {
    records = sessionRecords(manager.getBranch());
  } catch {
    return readonlyFrom(manager, 'damaged', readonlyMessages.invalid);
  }
  const { instructions, mode } = records;
  if (!instructions || !mode) return readonlyFrom(manager, 'incomplete', readonlyMessages.incomplete);
  return { kind: 'live', instructions, mode };
}

/** JSONL 损坏时逐行读取能识别的消息，只读打开。 */
export async function damagedHistory(file: string): Promise<SessionHistory> {
  const history = await readDamagedHistory(file);
  const { messages, lines } = damagedMessages(history);
  const header = history.entries[0]?.value;
  const sessionId = header?.type === 'session' && typeof header.id === 'string' && header.id ? header.id : null;
  return {
    kind: 'readonly',
    sessionId,
    readonly: { reason: 'damaged', message: readonlyMessages.damaged, lines },
    messages
  };
}
