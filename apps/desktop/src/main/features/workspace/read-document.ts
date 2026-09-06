import { isUtf8 } from 'node:buffer';
import { createHash } from 'node:crypto';
import type { ReadStream, Stats } from 'node:fs';
import { open, realpath, stat } from 'node:fs/promises';

import {
  MAX_DOCUMENT_BYTES,
  type ReadDocumentArgs,
  type ReadDocumentErrorCode,
  type WorkspaceDocument
} from '@chaptale/ipc-contract';

import { isBinaryContent, resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { parseDocumentHead } from './frontmatter';

export type DocumentReadOptions = { maxBytes?: number; timeoutMs?: number };

export class DocumentReadError extends Error {
  constructor(
    readonly code: ReadDocumentErrorCode,
    message: string
  ) {
    super(message);
  }
}

/** 限制读取本身及同步解码的总预算；超时后中止流，未完成的系统调用收束时释放文件句柄。 */
export async function readDocumentSnapshot(
  args: ReadDocumentArgs,
  options: DocumentReadOptions = {}
): Promise<WorkspaceDocument> {
  const maxBytes = Math.min(
    args.maxBytes ?? MAX_DOCUMENT_BYTES,
    options.maxBytes ?? MAX_DOCUMENT_BYTES,
    MAX_DOCUMENT_BYTES
  );
  const timeoutMs = options.timeoutMs ?? 10_000;
  const controller = new AbortController();
  const timeoutError = new DocumentReadError('read-timeout', '读取文件超时，请稍后重试');
  const deadline = performance.now() + timeoutMs;
  const checkDeadline = () => {
    if (performance.now() >= deadline) controller.abort(timeoutError);
    controller.signal.throwIfAborted();
  };
  checkDeadline();

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort(timeoutError);
      reject(timeoutError);
    }, timeoutMs);
  });

  try {
    return await Promise.race([readSnapshot(args, maxBytes, controller.signal, checkDeadline), timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function readSnapshot(
  args: ReadDocumentArgs,
  maxBytes: number,
  signal: AbortSignal,
  checkDeadline: () => void
): Promise<WorkspaceDocument> {
  const guardedPath = await resolveWithinCwd(args.rootPath, args.relativePath);
  const [realRoot, target] = await Promise.all([realpath(args.rootPath), realpath(guardedPath)]);
  // 打开已校验的真实路径；再次复核，防止前一次检查期间链接被换到工作区外。
  await resolveWithinCwd(realRoot, target);
  checkDeadline();
  const initial = await stat(target);
  assertReadableFile(initial, maxBytes);
  checkDeadline();

  const file = await open(target, 'r');
  let stream: ReadStream | undefined;
  try {
    checkDeadline();
    const before = await file.stat();
    assertReadableFile(before, maxBytes);
    const chunks: Buffer[] = [];
    let sizeBytes = 0;
    // end 为包含边界：最多读取上限 + 1 字节，能识别读取期间增长且不会无界分配。
    stream = file.createReadStream({ autoClose: false, highWaterMark: 64 * 1024, start: 0, end: maxBytes, signal });
    for await (const chunk of stream) {
      checkDeadline();
      const bytes = chunk as Buffer;
      sizeBytes += bytes.length;
      if (sizeBytes > maxBytes) throw tooLarge(maxBytes);
      chunks.push(bytes);
    }

    checkDeadline();
    const after = await file.stat();
    await resolveWithinCwd(args.rootPath, args.relativePath);
    const current = await stat(guardedPath);
    if (
      !sameSnapshot(initial, before) ||
      !sameSnapshot(before, after) ||
      !sameSnapshot(after, current) ||
      sizeBytes !== after.size
    ) {
      throw new DocumentReadError('file-changed', '文件在读取期间发生变化，请重新读取');
    }

    const bytes = Buffer.concat(chunks, sizeBytes);
    if (isBinaryContent(bytes)) throw new DocumentReadError('binary-file', '此文件是二进制文件，无法作为文本打开');
    if (!isUtf8(bytes)) {
      throw new DocumentReadError('unsupported-encoding', '此文件不是有效的 UTF-8 文本，请在外部转换编码后重新打开');
    }
    const contentHash = createHash('sha256').update(bytes).digest('hex');
    const content = bytes.toString('utf8');
    const head = parseDocumentHead(content);
    checkDeadline();
    return {
      rootPath: args.rootPath,
      relativePath: args.relativePath,
      content,
      head,
      sizeBytes,
      mtimeMs: after.mtimeMs,
      contentHash
    };
  } finally {
    stream?.destroy();
    await file.close();
  }
}

function tooLarge(maxBytes: number) {
  const limit = maxBytes >= 1024 * 1024 ? `${maxBytes / (1024 * 1024)} MiB` : `${maxBytes} 字节`;
  return new DocumentReadError('too-large', `文件超过本次读取上限（${limit}），未加载或截断原文`);
}

function assertReadableFile(info: Stats, maxBytes: number) {
  if (!info.isFile()) throw new DocumentReadError('not-a-file', '只能打开普通文件');
  if (info.size > maxBytes) throw tooLarge(maxBytes);
}

function sameSnapshot(a: Stats, b: Stats) {
  return a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
}
