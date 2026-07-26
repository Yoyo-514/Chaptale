import type { BrowserWindow, OpenDialogOptions } from 'electron';
import { unique } from 'radash';

import type { ContextFilePlatform, ContextImagePreview } from '../../core/context/platform';
import { DOCUMENT_MIME_TYPES, IMAGE_MIME_TYPES, TEXT_EXTENSIONS } from '../filesystem/file-kind';
import { showOpenDialog } from './dialog';
import { createElectronThumbnail } from './thumbnail';

export class ElectronContextFilePlatform implements ContextFilePlatform {
  async selectContextFilePaths(owner?: unknown): Promise<string[]> {
    const result = await showOpenDialog(owner as BrowserWindow | null | undefined, createOpenDialogOptions());
    return result.canceled ? [] : result.filePaths;
  }

  async createImagePreview(data: Uint8Array, mimeType: string): Promise<ContextImagePreview | undefined> {
    return createElectronThumbnail(Buffer.from(data), mimeType);
  }
}

function createOpenDialogOptions(): OpenDialogOptions {
  return {
    title: '添加上下文文件',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: '支持的上下文文件', extensions: getContextFileExtensions() },
      { name: '所有文件', extensions: ['*'] }
    ]
  };
}

function getContextFileExtensions() {
  const textExtensions = Array.from(TEXT_EXTENSIONS, extension => extension.slice(1));
  const documentExtensions = Object.keys(DOCUMENT_MIME_TYPES).map(extension => extension.slice(1));
  const imageExtensions = Object.keys(IMAGE_MIME_TYPES).map(extension => extension.slice(1));

  return unique([...textExtensions, ...documentExtensions, ...imageExtensions]);
}
