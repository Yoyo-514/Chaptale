import type { SessionManager } from '@earendil-works/pi-coding-agent';

import { decodeImageBase64, type ImageBlock } from '../../../core/attachments/service';
import { decodeContextMessage } from '../../../core/context/context-message-codec';
import { decodeMemoryMessage } from '../../../features/memory/message-codec';
import { decodeSkillMessage } from '../../../features/skills/message-codec';
import { getPiUserImageBlocks } from './user-image-blocks';

export type PiUserEntrySnapshot = {
  promptPrefix: string;
  /** 保留持久化消息中的真实 content 下标，session-entry source 必须与 readOriginal 对齐。 */
  imageBlocks: ImageBlock[];
};

function getUserText(message: unknown) {
  if (!message || typeof message !== 'object') {
    throw new Error('附件快照不是有效的 Pi 用户消息');
  }

  const record = message as Record<string, unknown>;

  if (record.role !== 'user') {
    throw new Error('附件快照来源不是用户消息');
  }

  if (typeof record.content === 'string') {
    return record.content;
  }

  if (!Array.isArray(record.content)) {
    throw new Error('附件快照缺少用户消息内容');
  }

  const textBlocks = record.content.filter((block): block is { type: 'text'; text: string } =>
    Boolean(
      block &&
      typeof block === 'object' &&
      (block as Record<string, unknown>).type === 'text' &&
      typeof (block as Record<string, unknown>).text === 'string'
    )
  );

  if (textBlocks.length !== 1) {
    throw new Error('附件快照必须包含且仅包含一个 Pi 文本块');
  }

  return textBlocks[0].text;
}

/**
 * 从历史用户条目恢复可复用的上下文信封与图片块。
 *
 * 复用前严格校验条目角色、文本块数量和图片体积，避免编辑/重试流程把损坏的持久化内容重新提交给模型。
 */
export function getPiUserEntrySnapshot(sessionManager: SessionManager, entryId: string): PiUserEntrySnapshot {
  const entry = sessionManager.getEntry(entryId);

  if (!entry || entry.type !== 'message') {
    throw new Error('找不到需要复用的 Pi 用户消息');
  }

  const text = getUserText(entry.message);
  const imageBlocks = getPiUserImageBlocks(entry.message);

  for (const image of imageBlocks) {
    if (!decodeImageBase64(image)) {
      throw new Error('历史消息包含无效或超限图片，无法安全复用');
    }
  }

  const decodedSkill = decodeSkillMessage(text);
  // 复用需逐字重现原 prompt 前缀：包含当时的 memory 注入块与上下文信封。
  const decodedMemory = decodeMemoryMessage(decodedSkill.text);

  return {
    promptPrefix: `${decodedMemory.promptPrefix}${decodeContextMessage(decodedMemory.text).promptPrefix}`,
    imageBlocks
  };
}
