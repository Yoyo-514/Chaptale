import type { SessionEntry, SessionManager } from '@earendil-works/pi-coding-agent';

import { normalizeInstructions, normalizeMode } from '../instructions/instructions.ts';
import {
  type AgentInstructions,
  type ChatMessage,
  type EditMode,
  instructionsEntryType,
  modeEntryType,
  type ReadonlyHistory
} from '../protocol.ts';
import {
  type DamagedHistory,
  HostSessionOpenError,
  openHostSessionManager,
  readDamagedHistory
} from '../session/session-storage.ts';
import { messageView, type SdkMessage } from './message-view.ts';

/** 打开历史的结论：完整历史可继续对话；损坏或缺少记录的只能查看。 */
export type SessionHistory =
  | { kind: 'live'; instructions: AgentInstructions; mode: EditMode }
  | { kind: 'readonly'; readonly: ReadonlyHistory; messages: ChatMessage[] };

const readonlyMessages = {
  incomplete: '缺少指令或修改模式记录，对话不完整，只能查看，不能继续',
  invalid: '指令或修改模式记录无效，只能查看，不能继续；原文件未修改',
  damaged: '会话历史部分损坏，只能查看，不能继续；原文件未修改'
};

/** 当前分支上最近一次的指令与模式记录；记录内容无效时抛错。 */
function sessionRecords(branch: SessionEntry[]): { instructions?: AgentInstructions; mode?: EditMode } {
  let instructions: AgentInstructions | undefined;
  let mode: EditMode | undefined;
  for (let index = branch.length - 1; index >= 0 && (!instructions || !mode); index--) {
    const entry = branch[index];
    if (entry.type !== 'custom') continue;
    const data = entry.data as { entries?: unknown; mode?: unknown } | undefined;
    if (!instructions && entry.customType === instructionsEntryType)
      instructions = normalizeInstructions(data?.entries);
    else if (!mode && entry.customType === modeEntryType) mode = normalizeMode(data?.mode);
  }
  return { instructions, mode };
}

/** 损坏历史按文件顺序显示能识别的消息，其余行计入坏行。 */
function damagedMessages(history: DamagedHistory): { messages: ChatMessage[]; lines: number[] } {
  const messages: ChatMessage[] = [];
  const lines = [...history.damagedLines];
  for (const { line, value } of history.entries) {
    if (value.type !== 'message') continue;
    // SAFETY: 下面确认 role 与 content 的形状后才交给 messageView；它只读取这些字段及可选的 toolName/isError。
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
  // oxlint-disable-next-line unicorn/no-array-sort
  return { messages, lines: lines.sort((a, b) => a - b) };
}

function readonlyFrom(manager: SessionManager, reason: ReadonlyHistory['reason'], message: string): SessionHistory {
  const messages = manager.buildSessionContext().messages.map(messageView);
  return { kind: 'readonly', readonly: { reason, message, lines: [] }, messages };
}

/**
 * 读取历史并判定能否继续；不创建 AgentSession，不修复、不写入原文件。
 * 需迁移、路径错误或不属于当前作品的历史仍按 HostSessionOpenError 报错。
 */
export async function readSessionHistory(file: string, cwd: string): Promise<SessionHistory> {
  let manager: SessionManager;
  try {
    manager = await openHostSessionManager({ file, cwd });
  } catch (error) {
    if (!(error instanceof HostSessionOpenError) || error.code !== 'recovery-required') throw error;
    const { messages, lines } = damagedMessages(await readDamagedHistory(file));
    return { kind: 'readonly', readonly: { reason: 'damaged', message: readonlyMessages.damaged, lines }, messages };
  }
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
