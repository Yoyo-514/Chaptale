import { unzipSync } from 'fflate';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

const MAX_ENTRY_BYTES = 256 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024;
const MAX_ENTRIES = 20_000;

/** 归档来自远端，不接受会在不同平台产生歧义的路径或 Windows 数据流。 */
export function validateArchivePath(name: string): void {
  const relative = name.endsWith('/') ? name.slice(0, -1) : name;
  if (
    !relative ||
    path.posix.isAbsolute(relative) ||
    path.win32.isAbsolute(relative) ||
    /[\\:\0]/.test(relative) ||
    relative.split('/').some(part => !part || part === '.' || part === '..' || /[. ]$/.test(part))
  ) {
    throw new Error(`归档条目越出目标目录或路径不规范：${name}`);
  }
}

/**
 * 每个条目解压前验证名称和声明体积；整包通过后调用方才开始写盘。
 * 限额按解压体积计算，不能用下载 ZIP 的压缩体积代替内存预算。
 */
export async function readArchiveEntries(
  archivePath: string,
  selectedPath?: string
): Promise<Record<string, Uint8Array>> {
  let total = 0;
  let count = 0;
  return unzipSync(new Uint8Array(await readFile(archivePath)), {
    filter(entry) {
      validateArchivePath(entry.name);
      total += entry.originalSize;
      count += 1;
      if (entry.originalSize > MAX_ENTRY_BYTES || total > MAX_ARCHIVE_BYTES || count > MAX_ENTRIES) {
        throw new Error('归档超过安全解压上限（单文件 256 MiB、总计 1 GiB、20000 个条目）');
      }
      return selectedPath === undefined || entry.name === selectedPath;
    }
  });
}
