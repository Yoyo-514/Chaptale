import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';
import type { ChatDisplayMessage, MessageBranchControl } from '../../types';
import { hasRenderableMessage } from './message-content';

export function buildDisplayMessagesFromEntries(entries: ChaptaleSessionTreeEntry[], leafId: string | null) {
  const entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const branchEntryIds = getBranchEntryIds(entryMap, leafId ?? entries.at(-1)?.id ?? null);
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

    if (entry.type !== 'message' && entry.type !== 'custom_message') {
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
    .filter((candidate): candidate is Extract<ChaptaleSessionTreeEntry, { type: 'message' | 'custom_message' }> =>
      Boolean(
        (candidate.type === 'message' || candidate.type === 'custom_message') &&
        candidate.parentId === entry.parentId &&
        candidate.message.role === 'user'
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
    if (!entry.parentId) {
      continue;
    }

    const children = childrenByParent.get(entry.parentId) ?? [];
    children.push(entry);
    childrenByParent.set(entry.parentId, children);
  }

  let leafId = rootId;

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
