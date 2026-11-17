import type { AgentSession, SessionEntry, SessionManager, SessionTreeNode } from '@earendil-works/pi-coding-agent';

import { normalizeInstructions, normalizeMode } from '../instructions/instructions.ts';
import {
  type AgentInstructions,
  branchCursorEntryType,
  type EditMode,
  instructionsEntryType,
  type MessageBranch,
  modeEntryType
} from '../protocol/index.ts';

/** 当前分支上最近一次的指令与模式记录；记录内容无效时抛错。 */
export function sessionRecords(branch: SessionEntry[]): {
  instructions?: AgentInstructions;
  mode?: EditMode;
} {
  let instructions: AgentInstructions | undefined;
  let mode: EditMode | undefined;
  for (let index = branch.length - 1; index >= 0 && (!instructions || !mode); index--) {
    const entry = branch[index];
    if (entry.type !== 'custom') continue;
    const data = entry.data as { entries?: unknown; mode?: unknown } | undefined;
    if (!instructions && entry.customType === instructionsEntryType)
      instructions = normalizeInstructions(data?.entries);
    else if (!mode && entry.customType === modeEntryType) {
      mode = normalizeMode(data?.mode);
    }
  }
  return { instructions, mode };
}

function hasConversationMessage(node: SessionTreeNode): boolean {
  if (
    node.entry.type === 'message' &&
    (node.entry.message.role === 'user' || node.entry.message.role === 'assistant')
  ) {
    return true;
  }
  return node.children.some(hasConversationMessage);
}

function latestLeafId(node: SessionTreeNode): string {
  let current = node;
  while (current.children.length > 0) {
    const conversational = current.children.filter(hasConversationMessage);
    current = (conversational.at(-1) ?? current.children.at(-1))!;
  }
  return current.entry.id;
}

/** 计算当前活动分支上各分叉点对应的兄弟分支序号与前后切换目标。 */
export function branchMap(manager: SessionManager, branchIds: ReadonlySet<string>): Map<string, MessageBranch> {
  const map = new Map<string, MessageBranch>();
  let siblings = manager.getTree();
  while (siblings.length > 0) {
    const active = siblings.find(node => branchIds.has(node.entry.id));
    if (!active) break;
    const visible = siblings.filter(hasConversationMessage);
    const index = visible.indexOf(active);
    if (visible.length > 1 && index !== -1) {
      let cursor: SessionTreeNode | undefined = active;
      while (cursor && !(cursor.entry.type === 'message' && cursor.entry.message.role === 'user')) {
        cursor = cursor.children.find(child => branchIds.has(child.entry.id));
      }
      map.set(cursor?.entry.id ?? active.entry.id, {
        index: index + 1,
        total: visible.length,
        ...(index > 0 && { prevLeafId: latestLeafId(visible[index - 1]!) }),
        ...(index + 1 < visible.length && { nextLeafId: latestLeafId(visible[index + 1]!) })
      });
    }
    siblings = active.children;
  }
  return map;
}

/** 回退到目标作者消息之前以原地分叉，并补齐当前会话生效的指令与模式记录。 */
export async function rewindForMessageEdit(
  session: AgentSession,
  entryId: string,
  instructions: AgentInstructions,
  mode: EditMode
): Promise<void> {
  const manager = session.sessionManager;
  const entry = manager.getEntry(entryId);
  if (!entry || entry.type !== 'message' || entry.message.role !== 'user') throw new Error('目标作者消息不存在');
  await session.navigateTree(entryId);
  const records = sessionRecords(manager.getBranch());
  if (JSON.stringify(records.instructions) !== JSON.stringify(instructions)) {
    manager.appendCustomEntry(instructionsEntryType, { entries: instructions });
  }
  if (records.mode !== mode) {
    manager.appendCustomEntry(modeEntryType, { mode });
  }
}

/** 切换到目标分支叶子并写入分支游标，使重新打开历史文件时保持同一分支。 */
export async function navigateToBranchLeaf(
  session: AgentSession,
  leafId: string
): Promise<{ instructions?: AgentInstructions; mode?: EditMode }> {
  const manager = session.sessionManager;
  if (!manager.getEntry(leafId)) throw new Error('目标分支节点不存在');
  const previousLeafId = manager.getLeafId();
  if (previousLeafId !== leafId) {
    manager.branch(leafId);
    const cursorId = manager.appendCustomEntry(branchCursorEntryType, {});
    if (previousLeafId === null) manager.resetLeaf();
    else manager.branch(previousLeafId);
    await session.navigateTree(cursorId);
  }
  return sessionRecords(manager.getBranch());
}
