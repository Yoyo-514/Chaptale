import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';

import type { ChatDisplayMessage, MessageBranchControl } from '../../types';
import { hasRenderableMessage } from './message-content';

/** 分支切换标记：会话树上的事件节点，不是内容，任何"选一个叶子"的场景都要绕开它。 */
function isBranchMarker(entry: ChaptaleSessionTreeEntry): boolean {
  return entry.type === 'custom' && entry.name === 'branch_selected';
}

/**
 * 无 leaf 可依据时的兜底：最后一条非标记节点。
 *
 * 标记节点的 parentId 是**切换发生时**的 leaf，从它回溯得到的是切换前那条路径，
 * 而不是作者刚切过去的分支。
 */
export function resolveFallbackLeafId(entries: ChaptaleSessionTreeEntry[]): string | null {
  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];

    if (!isBranchMarker(entry)) {
      return entry.id;
    }
  }

  return null;
}

/**
 * 从会话树的指定叶子回溯出当前分支，并转换为可展示消息。
 * compaction 与 run_stop 都不单独占消息行，而是附着到相邻的可展示消息——
 * 前者挂在其后的首条，后者挂在其前的末条；用户节点同时计算兄弟分支导航。
 *
 * 入参是**全量**会话树：兄弟分支的判据是"同 parentId 下有几个 user 节点"，
 * 只喂当前分支时每层恒为一个节点，导航就永远算不出来。
 */
export function buildDisplayMessagesFromEntries(entries: ChaptaleSessionTreeEntry[], leafId: string | null) {
  const entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const branchEntryIds = getBranchEntryIds(entryMap, leafId ?? resolveFallbackLeafId(entries));
  const displayMessages: ChatDisplayMessage[] = [];
  let pendingCompaction: ChatDisplayMessage['compactionBefore'];

  for (const id of branchEntryIds) {
    const entry = entryMap.get(id);

    if (!entry) {
      continue;
    }

    if (entry.type === 'compaction') {
      pendingCompaction = { summary: entry.summary, tokensBefore: entry.tokensBefore };
      continue;
    }

    if (entry.type === 'run_stop') {
      // 附着到已经产出的最后一条：截停发生在它之后。分支上只有截停记录、
      // 前面一条可展示消息都没有时无处可挂，那种会话本来也没有正文可解释。
      const previous = displayMessages.at(-1);

      if (previous) {
        previous.stopNoticeAfter = entry.reason;
      }

      continue;
    }

    if (entry.type !== 'message') {
      continue;
    }

    if (!hasRenderableMessage(entry.message)) {
      continue;
    }

    displayMessages.push({
      id: entry.id,
      entryId: entry.id,
      parentEntryId: entry.parentId,
      message: entry.message,
      branch: entry.message.role === 'user' ? getUserBranchControl(entries, entry) : undefined,
      compactionBefore: pendingCompaction
    } satisfies ChatDisplayMessage);
    pendingCompaction = undefined;
  }

  return displayMessages;
}

function getBranchEntryIds(entryMap: Map<string, ChaptaleSessionTreeEntry>, leafId: string | null) {
  const ids: string[] = [];
  const visited = new Set<string>();
  let currentId = leafId;

  // visited 同时防御损坏会话中的父链环，避免历史页陷入无限回溯。
  while (currentId && !visited.has(currentId)) {
    const entry = entryMap.get(currentId);

    if (!entry) {
      break;
    }

    visited.add(currentId);
    ids.push(currentId);
    currentId = entry.parentId;
  }

  return ids.toReversed();
}

function getUserBranchControl(
  entries: ChaptaleSessionTreeEntry[],
  entry: Extract<ChaptaleSessionTreeEntry, { type: 'message' | 'custom_message' }>
): MessageBranchControl | undefined {
  const siblingUsers = entries
    .filter((candidate): candidate is Extract<ChaptaleSessionTreeEntry, { type: 'message' }> =>
      Boolean(
        candidate.type === 'message' && candidate.parentId === entry.parentId && candidate.message.role === 'user'
      )
    )
    .toSorted((left, right) => left.timestamp.localeCompare(right.timestamp));

  if (siblingUsers.length <= 1) {
    return undefined;
  }

  const currentIndex = siblingUsers.findIndex(candidate => candidate.id === entry.id);

  if (currentIndex === -1) {
    return undefined;
  }

  return {
    current: currentIndex + 1,
    total: siblingUsers.length,
    previousLeafId: getDeepestLeafId(entries, siblingUsers[currentIndex - 1]?.id),
    nextLeafId: getDeepestLeafId(entries, siblingUsers[currentIndex + 1]?.id)
  };
}

function getDeepestLeafId(entries: ChaptaleSessionTreeEntry[], rootId?: string) {
  if (!rootId) {
    return undefined;
  }

  const childrenByParent = new Map<string, ChaptaleSessionTreeEntry[]>();

  for (const entry of entries) {
    // 标记节点不算子树：它挂在切换发生时的 leaf 下，被选成"最深叶"会让 leaf 停在一个事件上。
    if (!entry.parentId || isBranchMarker(entry)) {
      continue;
    }

    const children = childrenByParent.get(entry.parentId) ?? [];
    children.push(entry);
    childrenByParent.set(entry.parentId, children);
  }

  let leafId = rootId;

  // 分支入口跳转到该子树最新的后代，使切换后直接落在一条完整可读的路径末端。
  while (true) {
    const children = (childrenByParent.get(leafId) ?? []).toSorted((left, right) =>
      left.timestamp.localeCompare(right.timestamp)
    );

    if (children.length === 0) {
      return leafId;
    }

    leafId = children.at(-1)!.id;
  }
}
