import { lstat, open } from 'node:fs/promises';
import path from 'node:path';

import { resolveWithinCwd } from './path-guard';

export const MAX_MANAGED_TEXT_BYTES = 128 * 1024;

/** 配置内容不跟随链接；有界读取也覆盖文件在 stat 后继续增长的情况。 */
export async function resolveManagedPath(root: string, relative: string): Promise<string> {
  const target = await resolveWithinCwd(root, relative);
  const parts = path.relative(root, target).split(path.sep).filter(Boolean);
  let current = path.resolve(root);
  for (const part of ['', ...parts]) {
    if (part) current = path.join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) throw new Error('内容目录不支持符号链接');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  return target;
}

export async function readManagedText(root: string, relative: string, maxBytes = MAX_MANAGED_TEXT_BYTES) {
  const target = await resolveManagedPath(root, relative);
  const handle = await open(target, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size > maxBytes) throw new Error(`内容文件必须是小于 ${maxBytes} 字节的普通文本`);
    const bytes = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < bytes.length) {
      const { bytesRead } = await handle.read(bytes, size, bytes.length - size, size);
      if (bytesRead === 0) break;
      size += bytesRead;
    }
    if (size > maxBytes || bytes.subarray(0, size).includes(0)) throw new Error('内容文件过大或不是文本');
    await resolveManagedPath(root, relative);
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, size));
  } finally {
    await handle.close();
  }
}
