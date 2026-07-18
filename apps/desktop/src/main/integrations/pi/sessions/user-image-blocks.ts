import type { ImageBlock } from '../../../modules/attachments/service';

/**
 * 兼容 pi 持久化用户消息的 content 数组：blockIndex 必须保留原始下标，
 * 否则会话图片回读会定位到错误的原图。
 */
export function getPiUserImageBlocks(message: unknown): ImageBlock[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const record = message as Record<string, unknown>;

  if (record.role !== 'user' || !Array.isArray(record.content)) {
    return [];
  }

  return record.content.flatMap((item, blockIndex) => {
    if (!item || typeof item !== 'object') {
      return [];
    }

    const block = item as Record<string, unknown>;

    if (block.type !== 'image' || typeof block.data !== 'string' || typeof block.mimeType !== 'string') {
      return [];
    }

    return [{ type: 'image', data: block.data, mimeType: block.mimeType, blockIndex } satisfies ImageBlock];
  });
}
