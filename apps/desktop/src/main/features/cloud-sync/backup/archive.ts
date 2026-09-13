import { unzipSync, Zip, ZipDeflate, ZipPassThrough } from 'fflate';
import { createWriteStream } from 'node:fs';
import type { WriteStream } from 'node:fs';
import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { finished } from 'node:stream/promises';

/**
 * 归档打包与解包。
 *
 * 打包**流式写出**：逐个文件读入、压缩、推给写流并等待背压，内存里不会同时存在整份归档。
 * 解包沿用下载侧的内存预算（归档已整体在内存里），因此用同步解压——归档继续变大时的升级路径
 * 正是分片上传 + 流式解包，两者是同一件事的两面。
 */
export type ArchiveFile = {
  /** 归档内路径，正斜杠、无前导斜杠。 */
  relativePath: string;
  absolutePath: string;
  size: number;
};

export type WorkspaceArchiveContent = {
  files: ArchiveFile[];
  /**
   * 没有任何后代文件的目录。
   *
   * 文件路径能隐含地建出上层目录，但建不出**空目录**——不单独写条目，`灵感/`、`草稿/`
   * 这类还没放东西的目录在恢复后就消失了。用 zip 自己的目录条目保住，**不往作者目录里
   * 塞 `.gitkeep` 之类的占位文件**：占位文件作者看得见，又会被下一次打包收进去。
   */
  emptyDirectories: string[];
};

export type ArchiveProgress = (done: number, total: number) => void;

/** 系统垃圾文件名；不是作者内容，不进归档。 */
const SKIPPED_NAMES = new Set(['.DS_Store', 'Thumbs.db', 'desktop.ini']);

export async function collectWorkspaceContent(
  rootPath: string,
  signal?: AbortSignal
): Promise<WorkspaceArchiveContent> {
  const files: ArchiveFile[] = [];
  const directories: string[] = [];

  await walk(rootPath, '', files, directories, signal);

  const occupied = occupiedDirectories(files);

  // 名字排序让归档内容可预期：同一份作品在不同设备打出来的条目顺序一致。
  return {
    files: files.toSorted((left, right) => (left.relativePath < right.relativePath ? -1 : 1)),
    emptyDirectories: directories.filter(directory => !occupied.has(directory)).toSorted()
  };
}

/** 从文件路径反推所有“装得下东西”的目录。 */
function occupiedDirectories(files: ArchiveFile[]): Set<string> {
  const occupied = new Set<string>();

  for (const file of files) {
    let current = file.relativePath;

    while (current.includes('/')) {
      current = current.slice(0, current.lastIndexOf('/'));
      occupied.add(current);
    }
  }

  return occupied;
}

export async function packWorkspace(input: {
  rootPath: string;
  targetPath: string;
  onProgress?: ArchiveProgress;
  signal?: AbortSignal;
}): Promise<{ files: number; bytes: number }> {
  const content = await collectWorkspaceContent(input.rootPath, input.signal);
  const output = createWriteStream(input.targetPath);
  const chunks: Uint8Array[] = [];
  // 用持有对象而不是裸变量：回调里的赋值不受 TypeScript 控制流分析追踪，
  // 裸变量会在后续判断处被窄化成 null。
  const state: { failure: Error | null } = { failure: null };
  const zip = new Zip((error, chunk) => {
    if (error) {
      state.failure = error;
      return;
    }

    if (chunk) chunks.push(chunk);
  });

  const flush = async () => {
    while (chunks.length > 0) {
      const chunk = chunks.shift() as Uint8Array;

      if (!output.write(chunk)) {
        await drain(output);
      }
    }
  };

  try {
    // 空目录先写条目：它们在 zip 里没有文件条目可依附。
    for (const directory of content.emptyDirectories) {
      const entry = new ZipPassThrough(`${directory}/`);

      zip.add(entry);
      entry.push(new Uint8Array(0), true);

      if (state.failure) throw state.failure;

      await flush();
    }

    for (const [index, file] of content.files.entries()) {
      if (input.signal?.aborted) throw new Error('备份已取消');

      const entry = new ZipDeflate(file.relativePath, { level: 6 });

      zip.add(entry);
      entry.push(await readFile(file.absolutePath), true);

      if (state.failure) throw state.failure;

      await flush();
      input.onProgress?.(index + 1, content.files.length);
    }

    zip.end();

    if (state.failure) throw state.failure;

    await flush();
    output.end();
    await finished(output);
  } catch (error) {
    output.destroy();

    throw error;
  }

  return { files: content.files.length, bytes: (await stat(input.targetPath)).size };
}

export async function unpackArchive(input: {
  archivePath: string;
  targetPath: string;
  onProgress?: ArchiveProgress;
  signal?: AbortSignal;
}): Promise<{ files: number; bytes: number }> {
  const entries = unzipSync(new Uint8Array(await readFile(input.archivePath)));
  const names = Object.keys(entries).toSorted();
  let files = 0;
  let bytes = 0;

  for (const [index, name] of names.entries()) {
    if (input.signal?.aborted) throw new Error('恢复已取消');

    const target = resolveInside(input.targetPath, name);

    // 目录条目是空载荷；建出目录本身，不把它当成一个文件。
    if (name.endsWith('/')) {
      await mkdir(target, { recursive: true });
      continue;
    }

    const data = entries[name] as Uint8Array;

    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, data);
    files += 1;
    bytes += data.byteLength;
    input.onProgress?.(index + 1, names.length);
  }

  return { files, bytes };
}

/**
 * 解包前先自证：ZIP 条目名可能带 `../`，落到目标目录之外就是一次越界写入。
 *
 * 归档虽然由本应用生成，但远端文件是可被别人替换的——恢复侧不能假设来源可信。
 */
export function resolveInside(rootPath: string, relativePath: string): string {
  const base = path.resolve(rootPath);
  const target = path.resolve(base, relativePath.replace(/^[/\\]+/, ''));
  const inside = target === base || target.startsWith(base + path.sep);

  if (!inside) {
    throw new Error(`归档条目越出目标目录：${relativePath}`);
  }

  return target;
}

async function walk(
  rootPath: string,
  relative: string,
  files: ArchiveFile[],
  directories: string[],
  signal?: AbortSignal
) {
  const entries = await readdir(path.join(rootPath, relative), { withFileTypes: true });

  for (const entry of entries) {
    if (signal?.aborted) throw new Error('备份已取消');
    // 不跟随链接：既防作品目录逃逸，也避免目录环。
    if (entry.isSymbolicLink() || SKIPPED_NAMES.has(entry.name)) continue;

    const childRelative = relative ? `${relative}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      directories.push(childRelative);
      await walk(rootPath, childRelative, files, directories, signal);
      continue;
    }

    if (!entry.isFile()) continue;

    const absolutePath = path.join(rootPath, childRelative);

    files.push({ relativePath: childRelative, absolutePath, size: (await stat(absolutePath)).size });
  }
}

function drain(stream: WriteStream): Promise<void> {
  return new Promise((resolve, reject) => {
    const onDrain = () => {
      stream.off('error', onError);
      resolve();
    };
    const onError = (error: Error) => {
      stream.off('drain', onDrain);
      reject(error);
    };

    stream.once('drain', onDrain);
    stream.once('error', onError);
  });
}
