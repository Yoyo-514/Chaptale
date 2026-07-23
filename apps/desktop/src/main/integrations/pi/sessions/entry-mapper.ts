import type { SessionEntry, SessionInfo } from '@earendil-works/pi-coding-agent';

import type { ChaptaleSessionListItem, ChaptaleSessionScope, ChaptaleSessionTreeEntry } from '@chaptale/ipc-contract';

import type { ImageAttachmentService } from '../../../modules/attachments/service';
import { fromPiMessage } from './message-mapper';

export type SessionEntryMapperOptions = {
  sessionId: string;
  imageAttachmentService: ImageAttachmentService;
};

/**
 * 将 pi 的开放式会话条目联合映射为稳定 IPC 树节点。
 *
 * 已知条目提取界面所需字段；未知扩展保留为 custom 节点及原始 data，使上游新增条目类型不会让整棵会话树无法读取。
 */
export function toSessionTreeEntry(entry: SessionEntry, options?: SessionEntryMapperOptions): ChaptaleSessionTreeEntry {
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
      message:
        fromPiMessage(entry.message, {
          presentUserImages: images =>
            options
              ? options.imageAttachmentService.createPresentation(images, blockIndex => ({
                  type: 'session-entry',
                  sessionId: options.sessionId,
                  entryId: entry.id,
                  blockIndex
                }))
              : { attachments: [] }
        }) ??
        ({
          role: 'assistant',
          content: []
        } as const)
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

/** 把 pi 的文件级会话摘要与 Chaptale 计算的存储范围、用量合并为历史列表项。 */
export function toSessionListItem(
  info: SessionInfo,
  extras: { scope: ChaptaleSessionScope; totalTokens: number; totalCost: number }
): ChaptaleSessionListItem {
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
    lastMessagePreview: info.firstMessage || info.allMessagesText.slice(0, 80) || undefined,
    scope: extras.scope,
    totalTokens: extras.totalTokens,
    totalCost: extras.totalCost
  };
}
