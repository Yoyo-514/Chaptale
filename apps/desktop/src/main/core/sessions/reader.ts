import { promises as fs } from 'node:fs';

import type { ParsedSessionFile, SessionEntry, SessionHeader } from './entry';

/** 文件首行常量：非会话文件直接判废（list 枚举时跳过）。 */
export const SESSION_HEADER_TYPE = 'chaptale-session';

/**
 * 容错读取会话 JSONL 文件。
 *
 * - 首行 header 无效 → throw（调用方按"非会话文件"处理）；
 * - 最后一行解析失败 → 跳过并计数（进程崩溃截断保护）；
 * - 中间行解析失败 → 跳过并计数（进 storage debug info）；
 * - 末尾孤儿 user 消息是合法状态（重新生成场景），照常返回。
 */
export async function readSessionFile(filePath: string): Promise<ParsedSessionFile> {
  const raw = await fs.readFile(filePath, 'utf8');
  return parseSessionContent(raw);
}

/** 纯文本解析（golden 测试与 reader 共用同一实现）。 */
export function parseSessionContent(raw: string): ParsedSessionFile {
  const lines = raw.split('\n');

  // 去掉末尾换行产生的空尾行；只允许一个空行残留（截断判定用）。
  while (lines.length > 0 && lines.at(-1) === '') {
    lines.pop();
  }

  const header = parseHeader(lines[0]);

  if (!header) {
    throw new Error('Not a chaptale session file: missing or invalid header line');
  }

  const rest = lines.slice(1);
  const lastLineIndex = rest.length - 1;
  const entries: SessionEntry[] = [];
  let skippedMidLines = 0;
  let skippedTailLines = 0;

  for (const [index, line] of rest.entries()) {
    if (index === lastLineIndex && !line.trim()) {
      // 文件以换行结尾时 rest 尾部不会出现空行；空尾行视作截断残留。
      skippedTailLines += 1;
      continue;
    }

    const entry = parseEntryLine(line);

    if (entry) {
      entries.push(entry);
      continue;
    }

    if (index === lastLineIndex) {
      skippedTailLines += 1;
    } else {
      skippedMidLines += 1;
    }
  }

  return { header, entries, skippedMidLines, skippedTailLines };
}

function parseHeader(line: string | undefined): SessionHeader | null {
  if (!line) {
    return null;
  }

  const value = tryParseJson(line);

  if (
    value &&
    typeof value === 'object' &&
    (value as Record<string, unknown>).type === SESSION_HEADER_TYPE &&
    (value as Record<string, unknown>).version === 1 &&
    typeof (value as Record<string, unknown>).id === 'string'
  ) {
    return value as unknown as SessionHeader;
  }

  return null;
}

function parseEntryLine(line: string): SessionEntry | null {
  const value = tryParseJson(line);

  if (!value || typeof value !== 'object') {
    return null;
  }

  const record = value as Record<string, unknown>;

  if (typeof record.id !== 'string') {
    return null;
  }

  if (typeof record.parentId !== 'string' && record.parentId !== null) {
    return null;
  }

  return value as unknown as SessionEntry;
}

function tryParseJson(line: string): unknown {
  if (!line.trim()) {
    return null;
  }

  try {
    return JSON.parse(line);
  } catch {
    return null;
  }
}
