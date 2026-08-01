import type { ChatContextFile } from '@chaptale/shared';
import { parseXmlAttributes } from '@chaptale/shared';

const CONTEXT_ENVELOPE_PATTERN = /^<attached_context_files>\r?\n([\s\S]*?)\r?\n<\/attached_context_files>\r?\n\r?\n?/;
const FILE_PATTERN = /<file\b([^>]*)>/g;

function isContextFileKind(value: string | undefined): value is ChatContextFile['kind'] {
  return value === 'text' || value === 'document' || value === 'image' || value === 'unsupported';
}

function isSkippedReason(value: string | undefined): value is NonNullable<ChatContextFile['skippedReason']> {
  return (
    value === 'file-too-large' ||
    value === 'image-too-large' ||
    value === 'file-unavailable' ||
    value === 'document-format-unsupported' ||
    value === 'document-parse-failed' ||
    value === 'document-no-text' ||
    value === 'document-too-large' ||
    value === 'document-text-too-large'
  );
}

function getFileName(filePath: string) {
  return filePath.split(/[\\/]/).at(-1) || filePath;
}

function parseByteSize(value: string | undefined) {
  if (!value) {
    return 0;
  }

  const match = /^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB)$/i.exec(value.trim());

  if (!match) {
    return 0;
  }

  const units = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3 } as const;
  return Math.round(Number(match[1]) * units[match[2]!.toUpperCase() as keyof typeof units]);
}

function parseContextFiles(body: string): ChatContextFile[] {
  return Array.from(body.matchAll(FILE_PATTERN), match => {
    const attributes = parseXmlAttributes(match[1]!);
    const kind = isContextFileKind(attributes.kind)
      ? attributes.kind
      : attributes.handling === 'document-file-input'
        ? 'document'
        : 'text';

    return {
      path: attributes.path ?? '',
      name: getFileName(attributes.path ?? ''),
      size: parseByteSize(attributes.size),
      kind,
      mimeType: attributes.mimeType || undefined,
      skippedReason: isSkippedReason(attributes.reason) ? attributes.reason : undefined
    };
  }).filter(file => file.path && file.name && file.kind !== 'unsupported');
}

/**
 * 从用户消息开头拆出应用生成的上下文文件信封，并恢复可展示的文件元数据。
 *
 * 只识别完整且位于开头的信封；不完整或不位于开头的标记保持原样。
 */
export function decodeContextMessage(text: string) {
  const envelope = CONTEXT_ENVELOPE_PATTERN.exec(text);

  if (!envelope) {
    return { text, promptPrefix: '', contextFiles: [] as ChatContextFile[] };
  }

  return {
    text: text.slice(envelope[0].length),
    promptPrefix: envelope[0],
    contextFiles: parseContextFiles(envelope[1]!)
  };
}
