import { nativeImage } from 'electron';

import { MAX_CHAT_IMAGE_BYTES } from '@chaptale/shared';

import type { ThumbnailResult } from '../../modules/attachments/thumbnail-port';

const THUMBNAIL_MAX_EDGE = 256;
/** nativeImage 解码失败时，小于该体积的图片直接内联原图作为缩略图兜底。 */
const MAX_INLINE_PREVIEW_FALLBACK_BYTES = 2 * 1024 * 1024;

export function createNativeThumbnail(data: Buffer): ThumbnailResult {
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

/** nativeImage 失败时回退到内联原图；两者都不可用时返回 undefined，由调用方决定跳过还是报错。 */
export function createElectronThumbnail(data: Buffer, mimeType: string): ThumbnailResult | undefined {
  if (data.length === 0 || data.length > MAX_CHAT_IMAGE_BYTES) {
    return undefined;
  }

  try {
    return createNativeThumbnail(data);
  } catch {
    const fallback = createInlineImageDataUrl(data, mimeType);
    return fallback ? { dataUrl: fallback, width: 0, height: 0 } : undefined;
  }
}
