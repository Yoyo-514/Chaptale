import { promises as fs } from 'node:fs';

import { MAX_CHAT_IMAGE_BYTES, type ChatImageAttachment, type ChatImageSource } from '@chaptale/shared';

import { getFileKind, getImageMimeType, IMAGE_MIME_TYPES } from '../../infra/filesystem/file-kind';
import type { ThumbnailFactory, ThumbnailResult } from './thumbnail-port';

const THUMBNAIL_CACHE_LIMIT = 256;
const ALLOWED_IMAGE_MIME_TYPES = new Set(Object.values(IMAGE_MIME_TYPES));
const BASE64_PATTERN = /^[A-Za-z0-9+/]*={0,2}$/;

export type ImageBlock = {
  type: 'image';
  data: string;
  mimeType: string;
  blockIndex: number;
};

export type ImageAttachmentPresentation = {
  attachments: ChatImageAttachment[];
};

/**
 * 校验并解码内部图片块。
 *
 * MIME、Base64 结构和解码后体积都必须通过校验，避免把任意 data URL 或超限数据送入缩略图解码器。
 */
export function decodeImageBase64(image: Pick<ImageBlock, 'data' | 'mimeType'>) {
  if (!ALLOWED_IMAGE_MIME_TYPES.has(image.mimeType) || !image.data || image.data.length % 4 !== 0) {
    return undefined;
  }

  if (!BASE64_PATTERN.test(image.data)) {
    return undefined;
  }

  const data = Buffer.from(image.data, 'base64');

  if (data.length === 0 || data.length > MAX_CHAT_IMAGE_BYTES) {
    return undefined;
  }

  return data;
}

/** 处理项目内部图片块；上游消息结构的解析由 integrations 防腐层负责。 */
export class ImageAttachmentService {
  private readonly thumbnailCache = new Map<string, ThumbnailResult>();

  constructor(private readonly createThumbnail: ThumbnailFactory) {}

  private getThumbnail(data: Buffer, mimeType: string, source?: ChatImageSource) {
    const cacheKey =
      source?.type === 'session-entry' ? `${source.sessionId}:${source.entryId}:${source.blockIndex}` : undefined;
    const cached = cacheKey ? this.thumbnailCache.get(cacheKey) : undefined;

    if (cached) {
      // Map 保持插入顺序；重新插入命中项，使淘汰循环具备最近最少使用语义。
      this.thumbnailCache.delete(cacheKey!);
      this.thumbnailCache.set(cacheKey!, cached);
      return cached;
    }

    const thumbnail = this.createThumbnail(data, mimeType);

    if (cacheKey) {
      this.thumbnailCache.set(cacheKey, thumbnail);

      while (this.thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
        this.thumbnailCache.delete(this.thumbnailCache.keys().next().value!);
      }
    }

    return thumbnail;
  }

  createThumbnailPreview(data: Buffer, mimeType: string) {
    if (data.length === 0 || data.length > MAX_CHAT_IMAGE_BYTES) {
      throw new Error('图片超过缩略图生成限制');
    }

    return this.getThumbnail(data, mimeType);
  }

  /**
   * 将有效图片块转换为 Renderer 使用的轻量附件描述。
   *
   * 单张无法生成缩略图的图片会被跳过，不应阻断同一历史消息中其他内容的展示。
   */
  createPresentation(
    images: readonly ImageBlock[],
    sourceFactory?: (blockIndex: number) => ChatImageSource | undefined
  ): ImageAttachmentPresentation {
    const attachments: ChatImageAttachment[] = [];

    for (const image of images) {
      const data = decodeImageBase64(image);

      if (!data) {
        console.warn(`[image-attachment] 跳过无效图片块：blockIndex=${image.blockIndex} mimeType=${image.mimeType}`);
        continue;
      }

      const source = sourceFactory?.(image.blockIndex);
      let thumbnail: ThumbnailResult;

      try {
        thumbnail = this.getThumbnail(data, image.mimeType, source);
      } catch (error) {
        // 损坏或平台不支持的图片不应阻断整段历史消息渲染，记录后跳过。
        console.warn(
          `[image-attachment] 缩略图生成失败：blockIndex=${image.blockIndex} mimeType=${image.mimeType} bytes=${data.length}`,
          error
        );
        continue;
      }

      const sourceId =
        source?.type === 'session-entry'
          ? `${source.sessionId}:${source.entryId}:${source.blockIndex}`
          : source?.type === 'context-file'
            ? `context-file:${source.path}`
            : `inline-image-${image.blockIndex}`;
      attachments.push({
        type: 'imageAttachment',
        id: sourceId,
        mimeType: image.mimeType,
        originalBytes: data.length,
        width: thumbnail.width,
        height: thumbnail.height,
        thumbnailDataUrl: thumbnail.dataUrl,
        source
      });
    }

    return { attachments };
  }

  readOriginal(images: readonly ImageBlock[], blockIndex: number) {
    const image = images.find(item => item.blockIndex === blockIndex);

    if (!image) {
      throw new Error('图片不存在');
    }

    const data = decodeImageBase64(image);

    if (!data) {
      throw new Error('图片数据无效或超过单图限制');
    }

    return { data: new Uint8Array(data), mimeType: image.mimeType };
  }

  async readContextFile(filePath: string) {
    const stats = await fs.stat(filePath);

    if (!stats.isFile() || getFileKind(filePath) !== 'image' || stats.size > MAX_CHAT_IMAGE_BYTES) {
      throw new Error('图片文件无效或超过单图限制');
    }

    // 不做整图解码校验：解码由渲染进程的 <img> 承担，主进程同步解码大图会阻塞所有 IPC。
    const data = await fs.readFile(filePath);
    return { data: new Uint8Array(data), mimeType: getImageMimeType(filePath) };
  }
}
