import type { ChatImageContent } from '@chaptale/shared';

import type { AppImagePreviewItem } from '@/components/AppImagePreview';

/** 把消息内容里的内联 base64 图片块转换为图片预览项（缩略图与原图同源）。 */
export function toInlineImageItems(images: readonly ChatImageContent[], idPrefix: string): AppImagePreviewItem[] {
  return images.map((image, index) => {
    const dataUrl = `data:${image.mimeType};base64,${image.data}`;

    return {
      id: `${idPrefix}-image-${index}`,
      alt: `图片 ${index + 1}`,
      thumbnailSrc: dataUrl,
      loadOriginal: async () => {
        const response = await fetch(dataUrl);
        return response.blob();
      }
    };
  });
}
