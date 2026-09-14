import { mkdir, readFile, rename, stat } from 'node:fs/promises';
import path from 'node:path';

import type {
  CloudRestoreArgs,
  CloudRestoreChoice,
  CloudRestoreDiffResult,
  CloudRestorePlanResult,
  CloudRestoreResult,
  CloudRestoreSkip
} from '@chaptale/ipc-contract';

import { toWorkspaceSessionDirName } from '../../../core/settings/workspace-session-directory';
import { writeBytesAtomically } from '../../../infra/filesystem/atomic-bytes';
import { resolveWithinCwd } from '../../../infra/filesystem/path-guard';
import { collectWorkspaceContent, unpackArchive } from './archive';
import { checksumFile } from './checksum';
import { manifestOf, readArchiveContent, readArchiveEntry, workspaceIdentityOf, type ArchiveContent } from './manifest';
import { conflictCopyName, sanitizeName, timestamp } from './remote-layout';
import { createRestoreGuard } from './restore-guard';
import { compareRestore } from './restore-plan';

export type RestoreWorkspaceTarget = { rootPath: string; id: string; title: string };
const MAX_DIFF_CHARS = 512 * 1024;

/**
 * 本地恢复只处理归档、快照与文件，不持有云凭据，也不解析当前作品。
 * 调用方先固定作品身份并持有操作锁，再把同一份归档交给这里。
 */
export class WorkspaceRestorer {
  constructor(private readonly cacheRoot: string) {}

  async plan(
    archivePath: string,
    workspace: RestoreWorkspaceTarget,
    archiveId: string
  ): Promise<CloudRestorePlanResult> {
    const content = await readArchiveContent(archivePath);
    const comparison = compareRestore({
      archive: manifestOf(content).files,
      local: await readLocalSide(workspace.rootPath)
    });
    return {
      ok: true,
      plan: {
        archiveId,
        identityMatches: workspaceIdentityOf(content) === workspace.id,
        entries: comparison.entries,
        emptyDirectories: content.directories,
        localOnly: comparison.localOnly
      }
    };
  }

  async diff(archivePath: string, rootPath: string, relativePath: string): Promise<CloudRestoreDiffResult> {
    const archived = await readArchiveEntry(archivePath, relativePath);
    if (!archived) throw new Error('归档里没有这个文件，重新算一次恢复计划');
    const localPath = await resolveWithinCwd(rootPath, relativePath);
    const local = await readFile(localPath);
    const archiveText = decodeText(archived);
    const localText = decodeText(local);
    const reason =
      archiveText === null || localText === null
        ? 'binary'
        : archiveText.length > MAX_DIFF_CHARS || localText.length > MAX_DIFF_CHARS
          ? 'too-large'
          : undefined;
    return reason
      ? { ok: true, text: false, reason, archiveBytes: archived.byteLength, localBytes: local.byteLength }
      : { ok: true, text: true, archiveText: archiveText!, localText: localText! };
  }

  async apply(
    archivePath: string,
    workspace: RestoreWorkspaceTarget,
    args: CloudRestoreArgs
  ): Promise<CloudRestoreResult> {
    if (args.mode === 'new') {
      const targetPath = await uniquePath(
        path.join(path.dirname(workspace.rootPath), `${sanitizeName(workspace.title)}-恢复-${timestamp(new Date())}`)
      );
      const unpacked = await unpackArchive({ archivePath, targetPath });
      return {
        ok: true,
        targetPath,
        mode: 'new',
        written: unpacked.files,
        writtenPaths: [],
        snapshotId: null,
        skipped: []
      };
    }

    // 解压一次供身份核验、路径预检、比对和写入共用，避免大归档重复占用内存。
    const content = await readArchiveContent(archivePath);
    if (workspaceIdentityOf(content) !== workspace.id) {
      throw new Error('这份归档不能自证是当前作品，未执行原地恢复');
    }
    const { rootPath } = workspace;
    for (const relative of [...content.files.map(file => file.relativePath), ...content.directories]) {
      await resolveWithinCwd(rootPath, relative);
    }
    const guard = await createRestoreGuard({
      workspaceRoot: rootPath,
      guardRoot: path.join(this.cacheRoot, toWorkspaceSessionDirName(rootPath), 'restore-guard'),
      at: new Date()
    });
    const result =
      args.mode === 'merge'
        ? await mergeIntoWorkspace(content, rootPath, args.choices ?? {})
        : await overwriteWorkspace(content, rootPath);
    for (const directory of content.directories) {
      await mkdir(await resolveWithinCwd(rootPath, directory), { recursive: true });
    }
    return {
      ok: true,
      targetPath: rootPath,
      mode: args.mode,
      written: result.writtenPaths.length,
      writtenPaths: result.writtenPaths,
      snapshotId: guard.id,
      skipped: result.skipped
    };
  }
}

/** 只覆盖归档内的路径，本地独有章节始终保留。 */
async function overwriteWorkspace(content: ArchiveContent, rootPath: string) {
  const writtenPaths: string[] = [];
  for (const file of content.files) {
    await writeBytesAtomically(await resolveWithinCwd(rootPath, file.relativePath), file.data);
    writtenPaths.push(file.relativePath);
  }
  return { writtenPaths, skipped: [] as CloudRestoreSkip[] };
}

async function mergeIntoWorkspace(
  content: ArchiveContent,
  rootPath: string,
  choices: Record<string, CloudRestoreChoice>
) {
  const comparison = compareRestore({ archive: manifestOf(content).files, local: await readLocalSide(rootPath) });
  const data = new Map(content.files.map(file => [file.relativePath, file.data]));
  const writtenPaths: string[] = [];
  const skipped: CloudRestoreSkip[] = [];
  const at = new Date();
  for (const entry of comparison.entries) {
    if (entry.verdict === 'identical') continue;
    const choice = choices[entry.relativePath];
    if (entry.verdict === 'conflict') {
      if (!choice) {
        skipped.push({ relativePath: entry.relativePath, reason: '你没对这项做决定，本地保持不动' });
        continue;
      }
      if (choice === 'local') continue;
    }
    const bytes = data.get(entry.relativePath);
    if (!bytes) throw new Error(`归档内容与清单不一致：${entry.relativePath}`);
    const target = await resolveWithinCwd(rootPath, entry.relativePath);
    if (entry.verdict === 'conflict' && choice === 'both') {
      const copy = await resolveWithinCwd(rootPath, conflictCopyName(entry.relativePath, at));
      await rename(target, await uniquePath(copy));
    }
    await writeBytesAtomically(target, bytes);
    writtenPaths.push(entry.relativePath);
  }
  return { writtenPaths, skipped };
}

/** 与打包共享遍历规则；比对靠内容指纹，不靠会被同步客户端改动的 mtime。 */
async function readLocalSide(rootPath: string) {
  const content = await collectWorkspaceContent(rootPath);
  const files = [];
  // 顺序读指纹，避免大作品同时打开成千上万个文件句柄。
  for (const file of content.files) {
    files.push({
      relativePath: file.relativePath,
      bytes: file.size,
      digest: await checksumFile(await resolveWithinCwd(rootPath, file.relativePath))
    });
  }
  return files;
}

async function uniquePath(candidate: string): Promise<string> {
  const extension = path.extname(candidate);
  const base = candidate.slice(0, candidate.length - extension.length);
  for (let index = 1; ; index += 1) {
    const current = index === 1 ? candidate : `${base}-${index}${extension}`;
    try {
      await stat(current);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return current;
      throw error;
    }
  }
}

function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
