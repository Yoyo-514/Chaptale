import { MAX_CHAT_IMAGE_BYTES, type ChatImageAttachment, type ChatImageSource } from '@chaptale/shared';

import { nativeImage } from 'electron';
import { promises as fs } from 'node:fs';

import { getFileKind, getImageMimeType, IMAGE_MIME_TYPES } from '../../infra/filesystem/file-kind';

const THUMBNAIL_MAX_EDGE = 256;
const THUMBNAIL_CACHE_LIMIT = 256;
/** nativeImage 解码失败时，小于该体积的图片直接内联原图作为缩略图兜底。 */
const MAX_INLINE_PREVIEW_FALLBACK_BYTES = 2 * 1024 * 1024;
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

type ThumbnailResult = {
  dataUrl: string;
  width: number;
  height: number;
};

type ThumbnailFactory = (data: Buffer) => ThumbnailResult;

function createNativeThumbnail(data: Buffer): ThumbnailResult {
  const image = nativeImage.createFromBuffer(data);

  if (image.isEmpty()) {
    throw new Error('无法解码图片');
  }

  const originalSize = image.getSize();
  const scale = Math.min(1, THUMBNAIL_MAX_EDGE / Math.max(originalSize.width, originalSize.height));
  const width = Math.max(1, Math.round(originalSize.width * scale));
  const height = Math.max(1, Math.round(originalSize.height * scale));
  const thumbnail = scale < 1 ? image.resize({ width, height, quality: 'good' }) : image;

  return {
    dataUrl: thumbnail.toDataURL(),
    width: originalSize.width,
    height: originalSize.height
  };
}

/**
 * 主进程 nativeImage 解不出的格式（部分平台的 webp/gif/bmp），渲染进程 Chromium 通常仍能显示；
 * 小图直接内联原图数据兜底，避免图片从消息里静默消失。
 */
export function createInlineImageDataUrl(data: Buffer, mimeType: string): string | undefined {
  if (data.length === 0 || data.length > MAX_INLINE_PREVIEW_FALLBACK_BYTES) {
    return undefined;
  }

  return `data:${mimeType};base64,${data.toString('base64')}`;
}

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

  constructor(private readonly createThumbnail: ThumbnailFactory = createNativeThumbnail) {}

  private getThumbnail(data: Buffer, source?: ChatImageSource) {
    const cacheKey =
      source?.type === 'session-entry' ? `${source.sessionId}:${source.entryId}:${source.blockIndex}` : undefined;
    const cached = cacheKey ? this.thumbnailCache.get(cacheKey) : undefined;

    if (cached) {
      // Map 保持插入顺序；重新插入命中项，使淘汰循环具备最近最少使用语义。
      this.thumbnailCache.delete(cacheKey!);
      this.thumbnailCache.set(cacheKey!, cached);
      return cached;
    }

    const thumbnail = this.createThumbnail(data);

    if (cacheKey) {
      this.thumbnailCache.set(cacheKey, thumbnail);

      while (this.thumbnailCache.size > THUMBNAIL_CACHE_LIMIT) {
        this.thumbnailCache.delete(this.thumbnailCache.keys().next().value!);
      }
    }

    return thumbnail;
  }

  createThumbnailPreview(data: Buffer) {
    if (data.length === 0 || data.length > MAX_CHAT_IMAGE_BYTES) {
      throw new Error('图片超过缩略图生成限制');
    }

    return this.getThumbnail(data);
  }

  /**
   * 将有效图片块转换为 Renderer 使用的轻量附件描述。
   *
   * 单张损坏图片会被跳过或以内联原图兜底，不应阻断同一历史消息中其他内容的展示。
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
        thumbnail = this.getThumbnail(data, source);
      } catch (error) {
        // 损坏或平台不支持的图片不应阻断整段历史消息渲染；小图内联原图兜底，大图记录后跳过。
        const fallbackDataUrl = createInlineImageDataUrl(data, image.mimeType);

        if (!fallbackDataUrl) {
          console.warn(
            `[image-attachment] 缩略图生成失败且无法内联兜底：blockIndex=${image.blockIndex} mimeType=${image.mimeType} bytes=${data.length}`,
            error
          );
          continue;
        }

        thumbnail = { dataUrl: fallbackDataUrl, width: 0, height: 0 };
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
