import type { SelectedContextFile } from '@chaptale/ipc-contract';

import { promises as fs } from 'node:fs';
import path from 'node:path';

import { MAX_PREVIEW_IMAGE_BYTES } from './constants';
import { getDocumentMimeType, getFileKind, getImageMimeType } from './file-kind';

export async function toSelectedContextFile(filePath: string): Promise<SelectedContextFile> {
  const stats = await fs.stat(filePath);
  const kind = getFileKind(filePath);
  const mimeType =
    kind === 'image' ? getImageMimeType(filePath) : kind === 'document' ? getDocumentMimeType(filePath) : undefined;
  let previewDataUrl: string | undefined;

  if (kind === 'image' && mimeType && stats.size <= MAX_PREVIEW_IMAGE_BYTES) {
    const data = await fs.readFile(filePath, 'base64');
    previewDataUrl = `data:${mimeType};base64,${data}`;
  }

  return {
    path: filePath,
    name: path.basename(filePath),
    size: stats.size,
    kind,
    mimeType,
    previewDataUrl
  };
}
