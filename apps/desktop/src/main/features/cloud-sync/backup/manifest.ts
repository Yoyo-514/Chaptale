import { ChaptaleManifestValidator } from '@chaptale/shared';

import type { FileIdentity } from '../file-identity';
import { readArchiveEntries } from './archive-reader';
import { checksum } from './checksum';

/** 作品清单的文件名：归档里那份就是“这部作品是谁”的自证。 */
export const WORKSPACE_MANIFEST_FILE = 'chaptale.json';

/**
 * 归档读回。
 *
 * 比对与恢复都要先知道归档里有什么：文件清单（含内容指纹）、空目录、以及单个文件的正文。
 * 清单阶段把整包解压进内存——和恢复用的是**同一份预算**（`unpackArchive` 早已如此）：
 * 归档继续变大时的升级路径是流式解包，与分片上传是同一件事的两面。
 *
 * 远端文件是别人可以替换的，所以这里对来源不做任何假设：读不出来的归档就是错误，不是空归档。
 */
export type ArchiveManifestFile = FileIdentity;

export type ArchiveManifest = {
  files: ArchiveManifestFile[];
  /** 目录条目（空目录）。文件路径隐含不出空目录，恢复时要把它们建出来。 */
  directories: string[];
};

export type ArchiveContent = {
  files: { relativePath: string; data: Uint8Array }[];
  directories: string[];
};

export async function readArchiveManifest(archivePath: string): Promise<ArchiveManifest> {
  return manifestOf(await readArchiveContent(archivePath));
}

/** 已经解出来的内容单独算指纹：合并在同一趟里既要比对又要写盘，不必再解一次包。 */
export function manifestOf(content: ArchiveContent): ArchiveManifest {
  return {
    files: content.files.map(file => ({
      relativePath: file.relativePath,
      bytes: file.data.byteLength,
      digest: checksum(file.data)
    })),
    directories: content.directories
  };
}

/** 整包解出（写盘与比对用）：与 `unpackArchive` 是同一份预算，区别只在“写到哪里”由调用方决定。 */
export async function readArchiveContent(archivePath: string): Promise<ArchiveContent> {
  const entries = await readArchiveEntries(archivePath);
  const files: ArchiveContent['files'] = [];
  const directories: string[] = [];

  for (const [name, data] of Object.entries(entries)) {
    // 目录条目在 zip 里以斜杠结尾；尾斜杠不进清单键，恢复时按路径建目录。
    if (name.endsWith('/')) directories.push(name.replace(/\/+$/, ''));
    else files.push({ relativePath: name, data });
  }

  return { files: files.toSorted(byPath), directories: directories.toSorted() };
}

/** 只解一个条目：看某一项的正文时，不需要把整包展开。 */
export async function readArchiveEntry(archivePath: string, relativePath: string): Promise<Uint8Array | null> {
  const entries = await readArchiveEntries(archivePath, relativePath);

  return entries[relativePath] ?? null;
}

/**
 * 归档里的作品身份。
 *
 * 读的是归档**自己**携带的 `chaptale.json`，不再跑一趟网络——它比远端标记更接近
 * “这份归档属于谁”这个问题。取不到或读不懂就是**不能自证**，调用侧按“不是同一部”处理。
 */
export async function parseWorkspaceIdentity(archivePath: string): Promise<string | null> {
  const bytes = await readArchiveEntry(archivePath, WORKSPACE_MANIFEST_FILE);

  return parseIdentity(bytes);
}

/** 已解压的恢复内容直接复用，避免为身份核验再解压同一份 ZIP。 */
export function workspaceIdentityOf(content: ArchiveContent): string | null {
  return parseIdentity(content.files.find(file => file.relativePath === WORKSPACE_MANIFEST_FILE)?.data ?? null);
}

function parseIdentity(bytes: Uint8Array | null): string | null {
  if (!bytes) {
    return null;
  }

  let raw: unknown;

  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return null;
  }

  return ChaptaleManifestValidator.Check(raw) ? raw.id : null;
}

function byPath(left: { relativePath: string }, right: { relativePath: string }): number {
  return left.relativePath < right.relativePath ? -1 : 1;
}
