import { createHash } from 'node:crypto';
import { lstat, open, readdir } from 'node:fs/promises';

import { resolveManagedPath } from '../../infra/filesystem/managed-text';

const MAX_BYTES = 64 * 1024 * 1024;
const MAX_ENTRIES = 1000;

/** 确认范围包含隐藏文件、二进制资源和空目录，不跟随任何链接。 */
export async function inspectContentFiles(root: string, relative: string) {
  const files: { path: string; bytes: number }[] = [];
  const records: unknown[] = [];
  let totalBytes = 0;
  let entries = 0;
  const walk = async (suffix: string, depth: number): Promise<void> => {
    if (++entries > MAX_ENTRIES || depth > 16) throw new Error('内容目录超过 1000 项或 16 层，请先在文件管理器整理');
    const target = await resolveManagedPath(root, suffix ? `${relative}/${suffix}` : relative);
    const info = await lstat(target);
    if (info.isDirectory()) {
      records.push([suffix, 'directory']);
      for (const child of (await readdir(target)).toSorted())
        await walk(suffix ? `${suffix}/${child}` : child, depth + 1);
      return;
    }
    if (!info.isFile()) throw new Error('内容包含非普通文件，不能自动管理');
    if (info.size + totalBytes > MAX_BYTES) throw new Error('内容附件超过 64 MiB，请先在文件管理器整理');
    const hash = createHash('sha256');
    const handle = await open(target, 'r');
    let bytes = 0;
    try {
      const buffer = Buffer.alloc(64 * 1024);
      let reading = true;
      while (reading) {
        const { bytesRead } = await handle.read(buffer, 0, buffer.length, bytes);
        reading = bytesRead > 0;
        bytes += bytesRead;
        if (totalBytes + bytes > MAX_BYTES) throw new Error('内容附件超过 64 MiB，请先在文件管理器整理');
        hash.update(buffer.subarray(0, bytesRead));
      }
      const after = await handle.stat();
      if (after.size !== info.size || after.mtimeMs !== info.mtimeMs || after.ino !== info.ino)
        throw new Error('内容附件正在变化，请刷新后重试');
    } finally {
      await handle.close();
    }
    await resolveManagedPath(root, suffix ? `${relative}/${suffix}` : relative);
    totalBytes += bytes;
    files.push({ path: suffix, bytes });
    records.push([suffix, 'file', bytes, hash.digest('hex')]);
  };
  await walk('', 0);
  return {
    files,
    bytes: totalBytes,
    fingerprint: createHash('sha256').update(JSON.stringify(records)).digest('hex')
  };
}
