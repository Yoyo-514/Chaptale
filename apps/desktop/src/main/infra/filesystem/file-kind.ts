import type { ChatContextFile } from '@chaptale/shared';

import path from 'node:path';

/** OpenAI File inputs 支持的常见文本/代码类文件；当前可直接按 UTF-8 文本注入。 */
export const TEXT_EXTENSIONS = new Set([
  '.txt',
  '.text',
  '.md',
  '.markdown',
  '.json',
  '.jsonl',
  '.ndjson',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.csv',
  '.tsv',
  '.log',
  '.xml',
  '.html',
  '.htm',
  '.css',
  '.scss',
  '.sass',
  '.less',
  '.sql',
  '.graphql',
  '.srt',
  '.vtt',
  '.eml',
  '.ics',
  '.vcf',
  '.conf',
  '.ini',
  '.properties',
  '.diff',
  '.patch',
  '.rst',
  '.tex',
  '.dockerfile',
  '.makefile',
  '.cmake',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.ts',
  '.tsx',
  '.vue',
  '.astro',
  '.py',
  '.java',
  '.kt',
  '.go',
  '.rs',
  '.c',
  '.cc',
  '.cpp',
  '.cxx',
  '.h',
  '.hh',
  '.hpp',
  '.cs',
  '.php',
  '.rb',
  '.sh',
  '.bash',
  '.zsh',
  '.ps1',
  '.bat',
  '.pl',
  '.r',
  '.lua',
  '.swift',
  '.scala',
  '.dart',
  '.ex',
  '.exs',
  '.erl',
  '.hrl',
  '.hs',
  '.clj',
  '.groovy',
  '.jl',
  '.awk'
]);

/** 常见文档/演示/表格文件；当前先作为上传文件元数据接入，后续接解析器或 provider 原生 file block。 */
export const DOCUMENT_MIME_TYPES: Record<string, string> = {
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.rtf': 'application/rtf',
  '.odt': 'application/vnd.oasis.opendocument.text',
  '.ods': 'application/vnd.oasis.opendocument.spreadsheet',
  '.odp': 'application/vnd.oasis.opendocument.presentation'
};

export const IMAGE_MIME_TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp'
};

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
