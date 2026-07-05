import type { ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';
import type { ChatDisplayMessage, MessageBranchControl } from '../../types';
import { hasRenderableMessage } from './message-content';

export function buildDisplayMessagesFromEntries(entries: ChaptaleSessionTreeEntry[], leafId: string | null) {
  const entryMap = new Map(entries.map(entry => [entry.id, entry]));
  const branchEntryIds = getBranchEntryIds(entryMap, leafId ?? entries.at(-1)?.id ?? null);
  const messageEntries = branchEntryIds
    .map(id => entryMap.get(id))
    .filter((entry): entry is Extract<ChaptaleSessionTreeEntry, { type: 'message' | 'custom_message' }> =>
      Boolean(entry && (entry.type === 'message' || entry.type === 'custom_message'))
    );

  return messageEntries
    .map(entry => {
      const variant = entry.message.type === 'system' && entry.message.payload.content.trim() ? 'error' : undefined;

      return {
        id: entry.id,
        entryId: entry.id,
        parentEntryId: entry.parentId,
        message: entry.message,
        variant,
        branch: entry.message.type === 'user' ? getUserBranchControl(entries, entry) : undefined
      } satisfies ChatDisplayMessage;
    })
    .filter(displayMessage => hasRenderableMessage(displayMessage.message, displayMessage.variant));
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

  return ids.reverse();
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
        candidate.message.type === 'user'
      )
    )
    .sort((left, right) => left.timestamp.localeCompare(right.timestamp));

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
    const children = [...(childrenByParent.get(leafId) ?? [])].sort((left, right) =>
      left.timestamp.localeCompare(right.timestamp)
    );

    if (children.length === 0) {
      return leafId;
    }

    leafId = children.at(-1)!.id;
  }
}
