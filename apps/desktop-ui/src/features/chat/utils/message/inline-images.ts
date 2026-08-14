import type { ChatImageAttachment } from '@chaptale/shared';

import type { AppImagePreviewItem } from '@/components/AppImagePreview';

import { readImageBlob } from '../image-blob';

/** 把轻量图片附件转换为图片预览项（缩略图直接用 dataUrl，原图经 IPC 按需读取）。 */
export function toInlineImageItems(images: readonly ChatImageAttachment[], idPrefix: string): AppImagePreviewItem[] {
  return images.map((image, index) => ({
    id: `${idPrefix}-image-${index}`,
    alt: `图片 ${index + 1}`,
    thumbnailSrc: image.thumbnailDataUrl,
    loadOriginal: async () =>
      image.source ? readImageBlob(image.source) : fetch(image.thumbnailDataUrl).then(r => r.blob())
  }));
}
