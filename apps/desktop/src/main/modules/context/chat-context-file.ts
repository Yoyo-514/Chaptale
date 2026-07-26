import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { ChatContextFile } from '@chaptale/shared';
import { MAX_CHAT_IMAGE_BYTES } from '@chaptale/shared';

import { getDocumentMimeType, getFileKind, getImageMimeType } from '../../infra/filesystem/file-kind';
import type { ContextFilePlatform } from './platform';

export async function toChatContextFile(filePath: string, platform: ContextFilePlatform): Promise<ChatContextFile> {
  const stats = await fs.stat(filePath);
  const kind = getFileKind(filePath);
  const mimeType =
    kind === 'image' ? getImageMimeType(filePath) : kind === 'document' ? getDocumentMimeType(filePath) : undefined;
  const preview =
    kind === 'image' && mimeType && stats.size <= MAX_CHAT_IMAGE_BYTES
      ? await fs
          .readFile(filePath)
          .then(data => platform.createImagePreview(data, mimeType))
          .catch(() => undefined)
      : undefined;

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    kind,
    mimeType,
    previewDataUrl: preview?.dataUrl,
    imageWidth: preview?.width,
    imageHeight: preview?.height
  };
}
