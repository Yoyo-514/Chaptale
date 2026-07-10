import type { SelectedContextFile } from '@chaptale/ipc-contract';
import type { ImageContent } from '@earendil-works/pi-ai/compat';

import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { promises as fs } from 'node:fs';
import { unique } from 'radash';

import {
  DOCUMENT_MIME_TYPES,
  IMAGE_MIME_TYPES,
  MAX_CONTEXT_FILE_BYTES,
  MAX_DIRECT_FILE_INPUT_BYTES,
  MAX_DIRECT_FILE_INPUT_TOTAL_BYTES,
  MAX_PROMPT_IMAGE_BYTES,
  TEXT_EXTENSIONS
} from './context-files/constants';
import { buildDocumentFileInputBlock, buildTextFileInputBlock } from './context-files/file-input';
import { getDocumentMimeType, getFileKind, getImageMimeType } from './context-files/file-kind';
import {
  buildFileSearchPlaceholderBlock,
  buildOversizedFileBlock,
  buildOversizedImageBlock
} from './context-files/file-search';
import { toSelectedContextFile } from './context-files/selected-context-file';

export type ResolvedContextFiles = {
  promptPrefix: string;
  images: ImageContent[];
  imagePaths: string[];
};

function getContextFileExtensions() {
  const textExtensions = Array.from(TEXT_EXTENSIONS, extension => extension.slice(1));
  const documentExtensions = Object.keys(DOCUMENT_MIME_TYPES).map(extension => extension.slice(1));
  const imageExtensions = Object.keys(IMAGE_MIME_TYPES).map(extension => extension.slice(1));

  return unique([...textExtensions, ...documentExtensions, ...imageExtensions]);
}

export class ContextFileService {
  async selectFiles(parentWindow?: BrowserWindow | null): Promise<SelectedContextFile[]> {
    const options: OpenDialogOptions = {
      title: '添加上下文文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '支持的上下文文件',
          extensions: getContextFileExtensions()
        },
        { name: '所有文件', extensions: ['*'] }
      ]
    };
    const result = parentWindow
      ? await dialog.showOpenDialog(parentWindow, options)
      : await dialog.showOpenDialog(options);

    if (result.canceled) {
      return [];
    }

    const selected: SelectedContextFile[] = [];

    for (const filePath of result.filePaths) {
      const file = await toSelectedContextFile(filePath);

      if (file.kind !== 'unsupported') {
        selected.push(file);
      }
    }

    return selected;
  }

  /** 校验拖拽传入的本地路径，不存在/不支持的文件会被过滤掉。 */
  async inspectFiles(filePaths: string[] = []): Promise<SelectedContextFile[]> {
    const inspected: SelectedContextFile[] = [];

    for (const filePath of unique(filePaths)) {
      const file = await toSelectedContextFile(filePath).catch(() => undefined);

      if (file && file.kind !== 'unsupported') {
        inspected.push(file);
      }
    }

    return inspected;
  }

  async resolve(filePaths: string[] = []): Promise<ResolvedContextFiles> {
    const uniquePaths = unique(filePaths);
    const textBlocks: string[] = [];
    const images: ImageContent[] = [];
    const imagePaths: string[] = [];
    let remainingDirectFileInputBytes = MAX_DIRECT_FILE_INPUT_TOTAL_BYTES;

    for (const filePath of uniquePaths) {
      const kind = getFileKind(filePath);

      if (kind === 'unsupported') {
        continue;
      }

      const stats = await fs.stat(filePath);

      if (kind === 'image' && stats.size > MAX_PROMPT_IMAGE_BYTES) {
        textBlocks.push(buildOversizedImageBlock(filePath, stats, MAX_PROMPT_IMAGE_BYTES));
        continue;
      }

      if (stats.size > MAX_CONTEXT_FILE_BYTES) {
        textBlocks.push(buildOversizedFileBlock(filePath, stats));
        continue;
      }

      if (kind === 'text') {
        if (stats.size <= MAX_DIRECT_FILE_INPUT_BYTES && stats.size <= remainingDirectFileInputBytes) {
          const text = await fs.readFile(filePath, 'utf8');
          remainingDirectFileInputBytes -= stats.size;
          textBlocks.push(buildTextFileInputBlock(filePath, stats, text));
          continue;
        }

        textBlocks.push(buildFileSearchPlaceholderBlock(filePath, stats));
        continue;
      }

      if (kind === 'document') {
        textBlocks.push(buildDocumentFileInputBlock(filePath, stats, getDocumentMimeType(filePath)));
        continue;
      }

      if (kind === 'image') {
        const data = await fs.readFile(filePath, 'base64');
        images.push({ type: 'image', data, mimeType: getImageMimeType(filePath) });
        imagePaths.push(filePath);
      }
    }

    return {
      promptPrefix:
        textBlocks.length > 0
          ? `<attached_context_files>\n${textBlocks.join('\n\n')}\n</attached_context_files>\n\n`
          : '',
      images,
      imagePaths
    };
  }
}
