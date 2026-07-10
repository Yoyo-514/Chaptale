import type { ChatContextFile } from '@chaptale/shared';

const CONTEXT_ENVELOPE_PATTERN = /^<attached_context_files>\r?\n([\s\S]*?)\r?\n<\/attached_context_files>\r?\n\r?\n?/;
const FILE_PATTERN = /<file\b([^>]*)>/g;
const ATTRIBUTE_PATTERN = /([\w:-]+)="([^"]*)"/g;

function decodeXmlAttribute(value: string) {
  return value
    .replaceAll('&quot;', '"')
    .replaceAll('&apos;', "'")
    .replaceAll('&lt;', '<')
    .replaceAll('&gt;', '>')
    .replaceAll('&amp;', '&');
}

function parseAttributes(source: string) {
  const attributes: Record<string, string> = {};

  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1]!] = decodeXmlAttribute(match[2]!);
  }

  return attributes;
}

function isContextFileKind(value: string | undefined): value is ChatContextFile['kind'] {
  return value === 'text' || value === 'document' || value === 'image' || value === 'unsupported';
}

function isSkippedReason(value: string | undefined): value is NonNullable<ChatContextFile['skippedReason']> {
  return value === 'file-too-large' || value === 'image-too-large';
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
    const attributes = parseAttributes(match[1]!);
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
