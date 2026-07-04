import type { ChaptaleSessionListItem, ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';
import type { SessionEntry, SessionInfo } from '@earendil-works/pi-coding-agent';

import { fromPiMessage } from './pi-session-message.mapper';

export function toSessionTreeEntry(entry: SessionEntry): ChaptaleSessionTreeEntry {
  if (entry.type === 'session_info') {
    return {
      type: 'session_info',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      name: entry.name
    };
  }

  if (entry.type === 'message') {
    return {
      type: 'message',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      message: fromPiMessage(entry.message) ?? {
        type: 'assistant',
        payload: { content: '' }
      }
    };
  }

  if (entry.type === 'compaction') {
    return {
      type: 'compaction',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      summary: entry.summary,
      firstKeptEntryId: entry.firstKeptEntryId,
      tokensBefore: entry.tokensBefore,
      details: entry.details,
      fromHook: entry.fromHook
    };
  }

  if (entry.type === 'branch_summary') {
    return {
      type: 'branch_summary',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      fromId: entry.fromId,
      summary: entry.summary,
      details: entry.details,
      fromHook: entry.fromHook
    };
  }

  if (entry.type === 'label') {
    return {
      type: 'label',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      targetId: entry.targetId,
      label: entry.label
    };
  }

  return {
    type: 'custom',
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
    name: entry.type,
    data: entry
  };
}

export function toSessionListItem(info: SessionInfo): ChaptaleSessionListItem {
  return {
    id: info.id,
    createdAt: info.created.toISOString(),
    cwd: info.cwd,
    path: info.path,
    parentSessionPath: info.parentSessionPath,
    name: info.name,
    updatedAt: info.modified.toISOString(),
    leafId: null,
    messageCount: info.messageCount,
    lastMessagePreview: info.firstMessage || info.allMessagesText.slice(0, 80) || undefined
  };
}
