import type { SelectedContextFile } from '@chaptale/ipc-contract';
import { MAX_CHAT_IMAGE_BYTES } from '@chaptale/shared';

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { createInlineImageDataUrl, ImageAttachmentService } from '../image-attachment.service';
import { getDocumentMimeType, getFileKind, getImageMimeType } from './file-kind';

const imageAttachmentService = new ImageAttachmentService();

export async function toSelectedContextFile(filePath: string): Promise<SelectedContextFile> {
  const stats = await fs.stat(filePath);
  const kind = getFileKind(filePath);
  const mimeType =
    kind === 'image' ? getImageMimeType(filePath) : kind === 'document' ? getDocumentMimeType(filePath) : undefined;
  let previewDataUrl: string | undefined;
  let imageWidth: number | undefined;
  let imageHeight: number | undefined;

  if (kind === 'image' && mimeType && stats.size <= MAX_CHAT_IMAGE_BYTES) {
    const data = await fs.readFile(filePath).catch(() => undefined);

    if (data) {
      try {
        const preview = imageAttachmentService.createThumbnailPreview(data);
        previewDataUrl = preview.dataUrl;
        imageWidth = preview.width;
        imageHeight = preview.height;
      } catch {
        // nativeImage 解码失败时，小图内联原图兜底，保证附件仍以图片形式展示。
        previewDataUrl = createInlineImageDataUrl(data, mimeType);
      }
    }
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    kind,
    mimeType,
    previewDataUrl,
    imageWidth,
    imageHeight
  };
}
