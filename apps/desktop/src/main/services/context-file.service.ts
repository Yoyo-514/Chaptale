import type { SelectedContextFile } from '@chaptale/ipc-contract';
import type { ImageContent } from '@earendil-works/pi-ai/compat';

import { dialog, type BrowserWindow, type OpenDialogOptions } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unique } from 'radash';

export type ResolvedContextFiles = {
  promptPrefix: string;
  images: ImageContent[];
};

const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.log',
  '.xml',
  '.html',
  '.css',
  '.scss',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.vue',
  '.py',
  '.java',
  '.go',
  '.rs',
  '.c',
  '.cpp',
  '.h',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.sh',
  '.ps1'
]);

const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif'
};

const MAX_TEXT_FILE_BYTES = 1024 * 1024;
const MAX_CONTEXT_FILES = 8;
/** 超过此体积的图片不生成内联预览，避免 IPC 携带大 payload。 */
const MAX_PREVIEW_IMAGE_BYTES = 5 * 1024 * 1024;

function getFileKind(filePath: string): SelectedContextFile['kind'] {
  const extension = path.extname(filePath).toLowerCase();

  if (IMAGE_MIME_TYPES[extension]) {
    return 'image';
  }

  if (TEXT_EXTENSIONS.has(extension)) {
    return 'text';
  }

  return 'unsupported';
}

function getImageMimeType(filePath: string) {
  return IMAGE_MIME_TYPES[path.extname(filePath).toLowerCase()] ?? 'application/octet-stream';
}

async function toSelectedContextFile(filePath: string): Promise<SelectedContextFile> {
  const stats = await fs.stat(filePath);
  const kind = getFileKind(filePath);
  const mimeType = kind === 'image' ? getImageMimeType(filePath) : undefined;
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

export class ContextFileService {
  async selectFiles(parentWindow?: BrowserWindow | null): Promise<SelectedContextFile[]> {
    const options: OpenDialogOptions = {
      title: '添加上下文文件',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: '支持的上下文文件',
          extensions: [
            'txt',
            'md',
            'json',
            'yaml',
            'yml',
            'csv',
            'log',
            'ts',
            'tsx',
            'js',
            'jsx',
            'vue',
            'py',
            'png',
            'jpg',
            'jpeg',
            'webp',
            'gif'
          ]
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

    const selected = await Promise.all(result.filePaths.slice(0, MAX_CONTEXT_FILES).map(toSelectedContextFile));
    return selected.filter(file => file.kind !== 'unsupported');
  }

  /** 校验拖拽传入的本地路径，不存在/不支持的文件会被过滤掉。 */
  async inspectFiles(filePaths: string[] = []): Promise<SelectedContextFile[]> {
    const uniquePaths = unique(filePaths).slice(0, MAX_CONTEXT_FILES);
    const inspected = await Promise.all(
      uniquePaths.map(filePath => toSelectedContextFile(filePath).catch(() => undefined))
    );

    return inspected.filter((file): file is SelectedContextFile => file !== undefined && file.kind !== 'unsupported');
  }

  async resolve(filePaths: string[] = []): Promise<ResolvedContextFiles> {
    const uniquePaths = unique(filePaths).slice(0, MAX_CONTEXT_FILES);
    const textBlocks: string[] = [];
    const images: ImageContent[] = [];

    for (const filePath of uniquePaths) {
      const kind = getFileKind(filePath);
      const stats = await fs.stat(filePath);

      if (kind === 'text') {
        if (stats.size > MAX_TEXT_FILE_BYTES) {
          textBlocks.push(`<file path="${filePath}" skipped="true">文件超过 1MB，已跳过全文注入。</file>`);
          continue;
        }

        const text = await fs.readFile(filePath, 'utf8');
        textBlocks.push(`<file path="${filePath}">\n${text}\n</file>`);
        continue;
      }

      if (kind === 'image') {
        const data = await fs.readFile(filePath, 'base64');
        images.push({ type: 'image', data, mimeType: getImageMimeType(filePath) });
      }
    }

    return {
      promptPrefix:
        textBlocks.length > 0
          ? `<attached_context_files>\n${textBlocks.join('\n\n')}\n</attached_context_files>\n\n`
          : '',
      images
    };
  }
}
