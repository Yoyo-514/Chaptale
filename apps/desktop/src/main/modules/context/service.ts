import type { BrowserWindow, OpenDialogOptions } from 'electron';
import { promises as fs } from 'node:fs';
import { unique } from 'radash';

import type { ChatContextFile } from '@chaptale/shared';

import { showOpenDialog } from '../../infra/electron/dialog';
import {
  DOCUMENT_MIME_TYPES,
  getDocumentMimeType,
  getFileKind,
  getImageMimeType,
  IMAGE_MIME_TYPES,
  TEXT_EXTENSIONS
} from '../../infra/filesystem/file-kind';
import type { ImageBlock } from '../attachments/service';
import { toChatContextFile } from './chat-context-file';
import {
  MAX_CONTEXT_FILE_BYTES,
  MAX_DIRECT_FILE_INPUT_BYTES,
  MAX_DIRECT_FILE_INPUT_TOTAL_BYTES,
  MAX_PROMPT_IMAGE_BYTES,
  MAX_TEXT_DOCUMENT_TOKENS
} from './constants';
import { buildDocumentFileInputBlock, buildTextFileInputBlock } from './file-input';
import {
  buildFileSearchPlaceholderBlock,
  buildOversizedFileBlock,
  buildOversizedImageBlock,
  buildUnavailableFileBlock
} from './file-search';
import { isTextWithinTokenLimit } from './token-counter';

export type ContextImage = Omit<ImageBlock, 'blockIndex'>;

export type ResolvedContextFiles = {
  promptPrefix: string;
  images: ContextImage[];
  imagePaths: string[];
};

function getContextFileExtensions() {
  const textExtensions = Array.from(TEXT_EXTENSIONS, extension => extension.slice(1));
  const documentExtensions = Object.keys(DOCUMENT_MIME_TYPES).map(extension => extension.slice(1));
  const imageExtensions = Object.keys(IMAGE_MIME_TYPES).map(extension => extension.slice(1));

  return unique([...textExtensions, ...documentExtensions, ...imageExtensions]);
}

/** 将本地上下文文件归一化为提示词片段与项目内部图片数据，不暴露模型 SDK 类型。 */
export class ContextFileService {
  async selectFiles(parentWindow?: BrowserWindow | null): Promise<ChatContextFile[]> {
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
    const result = await showOpenDialog(parentWindow, options);

    if (result.canceled) {
      return [];
    }

    const selected: ChatContextFile[] = [];

    for (const filePath of result.filePaths) {
      const file = await toChatContextFile(filePath);

      if (file.kind !== 'unsupported') {
        selected.push(file);
      }
    }

    return selected;
  }

  /** 校验拖拽传入的本地路径，不存在/不支持的文件会被过滤掉。 */
  async inspectFiles(filePaths: string[] = []): Promise<ChatContextFile[]> {
    const inspected: ChatContextFile[] = [];

    for (const filePath of unique(filePaths)) {
      const file = await toChatContextFile(filePath).catch(() => undefined);

      if (file && file.kind !== 'unsupported') {
        inspected.push(file);
      }
    }

    return inspected;
  }

  /**
   * 把本地文件解析为模型提示词前缀和图片块。
   *
   * 文本受单文件、累计字节及 token 上限约束，超限后降级为文件搜索占位；文档仅注入路径和元数据，
   * 正文由可用文件工具读取或检索；图片则独立编码，避免把二进制内容混入文本信封。
   */
  async resolve(filePaths: string[] = []): Promise<ResolvedContextFiles> {
    const uniquePaths = unique(filePaths);
    const textBlocks: string[] = [];
    const images: ContextImage[] = [];
    const imagePaths: string[] = [];
    let remainingDirectFileInputBytes = MAX_DIRECT_FILE_INPUT_TOTAL_BYTES;

    for (const filePath of uniquePaths) {
      const kind = getFileKind(filePath);

      if (kind === 'unsupported') {
        continue;
      }

      const stats = await fs.stat(filePath).catch(() => undefined);

      if (!stats?.isFile()) {
        textBlocks.push(buildUnavailableFileBlock(filePath, kind));
        continue;
      }

      if (kind === 'image' && stats.size > MAX_PROMPT_IMAGE_BYTES) {
        textBlocks.push(buildOversizedImageBlock(filePath, stats, MAX_PROMPT_IMAGE_BYTES));
        continue;
      }

      if (stats.size > MAX_CONTEXT_FILE_BYTES) {
        textBlocks.push(buildOversizedFileBlock(filePath, stats));
        continue;
      }

      if (kind === 'text') {
        // 累计预算覆盖整次请求，防止多个小文件分别合法但合计后挤爆模型上下文。
        if (stats.size <= MAX_DIRECT_FILE_INPUT_BYTES && stats.size <= remainingDirectFileInputBytes) {
          const text = await fs.readFile(filePath, 'utf8').catch(() => undefined);

          if (text === undefined) {
            textBlocks.push(buildUnavailableFileBlock(filePath, kind));
            continue;
          }

          if (isTextWithinTokenLimit(text, MAX_TEXT_DOCUMENT_TOKENS)) {
            textBlocks.push(buildTextFileInputBlock(filePath, stats, text));
            remainingDirectFileInputBytes -= stats.size;
            continue;
          }
        }

        textBlocks.push(buildFileSearchPlaceholderBlock(filePath, stats));
        continue;
      }

      if (kind === 'document') {
        textBlocks.push(buildDocumentFileInputBlock(filePath, stats, getDocumentMimeType(filePath)));
        continue;
      }

      const data = await fs.readFile(filePath, 'base64').catch(() => undefined);

      if (data === undefined) {
        textBlocks.push(buildUnavailableFileBlock(filePath, kind));
        continue;
      }

      images.push({ type: 'image', data, mimeType: getImageMimeType(filePath) });
      imagePaths.push(filePath);
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
