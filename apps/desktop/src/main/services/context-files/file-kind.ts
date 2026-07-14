import type { ChatContextFile } from '@chaptale/shared';

import path from 'node:path';

import { DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, TEXT_EXTENSIONS } from './constants';

export function getFileKind(filePath: string): ChatContextFile['kind'] {
  const extension = path.extname(filePath).toLowerCase();

  if (IMAGE_MIME_TYPES[extension]) {
    return 'image';
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }

  if (DOCUMENT_MIME_TYPES[extension]) {
    return 'document';
  }

  return 'unsupported';
}

export function getImageMimeType(filePath: string) {
  return IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

export function getDocumentMimeType(filePath: string) {
  return DOCUMENT_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}
