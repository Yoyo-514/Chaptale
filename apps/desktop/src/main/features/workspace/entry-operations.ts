import { createHash, randomUUID } from 'node:crypto';
import { constants, createReadStream } from 'node:fs';
import { copyFile, link, lstat, readdir, rename, unlink } from 'node:fs/promises';
import path from 'node:path';

import type {
  EntryPathArgs,
  InspectEntryResult,
  MutateEntryArgs,
  MutateEntryResult,
  WorkspaceEntryInfo
} from '@chaptale/ipc-contract';
import { patchDocumentFields } from '@chaptale/shared/document-frontmatter';

import type { ShellPort } from '../../core/ipc-ports';
import { createTextAtomically } from '../../infra/filesystem/atomic-text';
import { resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { isSafeRelativePath, validateEntryName } from './entry-path';
import { readDocumentSnapshot } from './read-document';
import type { WorkspaceService } from './service';

type Workspace = Pick<WorkspaceService, 'getState' | 'getLayout'>;

async function assertRoot(workspace: Workspace, rootPath: string) {
  if ((await workspace.getState()).rootPath !== rootPath) throw new Error('工作区已经切换');
}
async function fingerprint(target: string) {
  const hash = createHash('sha256');
  let entries = 0;
  async function visit(file: string, relative: string) {
    if (++entries > 10000) throw new Error('目录超过 10000 个条目，请在系统文件管理器中处理');
    const info = await lstat(file);
    hash.update(JSON.stringify([relative, info.dev, info.ino, info.size, info.mtimeMs, info.isSymbolicLink()]));
    if (info.isDirectory()) {
      for (const child of (await readdir(file)).toSorted()) await visit(path.join(file, child), `${relative}/${child}`);
    } else if (info.isFile()) {
      if (info.size > 100 * 1024 * 1024) throw new Error('文件超过 100 MiB，请在系统文件管理器中处理');
      for await (const chunk of createReadStream(file)) hash.update(chunk);
    }
  }
  await visit(target, '');
  return { version: hash.digest('hex'), entries };
}
async function inspect(workspace: Workspace, args: EntryPathArgs): Promise<WorkspaceEntryInfo> {
  await assertRoot(workspace, args.rootPath);
  if (!isSafeRelativePath(args.relativePath)) throw new Error('请选择作品内的文件或目录');
  const target = await resolveWithinCwd(args.rootPath, args.relativePath);
  const info = await lstat(target);
  if (info.isSymbolicLink() || (!info.isDirectory() && !info.isFile())) throw new Error('不能操作链接或特殊文件');
  const layout = await workspace.getLayout(args.rootPath);
  if (!layout.ok) throw new Error(layout.message);
  const protectedReason =
    args.relativePath.split('/').some(part => part.startsWith('.')) || args.relativePath === 'chaptale.json'
      ? '作品清单和内部文件不能在此移动或删除'
      : Object.values(layout.layout.roles).some(role => role.relativePath === args.relativePath)
        ? '这是作品资料库根目录，请保留目录映射'
        : undefined;
  return {
    relativePath: args.relativePath,
    kind: info.isDirectory() ? 'directory' : 'file',
    ...(await fingerprint(target)),
    ...(protectedReason ? { protectedReason } : {})
  };
}
export async function inspectWorkspaceEntry(workspace: Workspace, args: EntryPathArgs): Promise<InspectEntryResult> {
  try {
    return { ok: true, entry: await inspect(workspace, args) };
  } catch (error) {
    return { ok: false, message: String(error) };
  }
}
export async function revealWorkspaceEntry(workspace: Workspace, args: EntryPathArgs, ui: ShellPort) {
  await assertRoot(workspace, args.rootPath);
  if (args.relativePath && !isSafeRelativePath(args.relativePath)) throw new Error('路径必须位于作品内');
  const target = await resolveWithinCwd(args.rootPath, args.relativePath);
  await lstat(target);
  if (args.relativePath) ui.revealPath(target);
  else await ui.openPath(target);
}

export async function mutateWorkspaceEntry(
  workspace: Workspace,
  args: MutateEntryArgs,
  ui?: Pick<ShellPort, 'trashItem'>
): Promise<MutateEntryResult> {
  try {
    await assertRoot(workspace, args.rootPath);
    if (!isSafeRelativePath(args.relativePath)) throw new Error('不能操作作品根目录');
    const source = await resolveWithinCwd(args.rootPath, args.relativePath);
    const targetPath = args.targetPath;
    if (args.operation !== 'trash') {
      if (
        !targetPath ||
        !isSafeRelativePath(targetPath) ||
        targetPath.split('/').some(part => part.startsWith('.')) ||
        targetPath === 'chaptale.json'
      )
        throw new Error('目标必须位于作者目录');
      for (const name of targetPath.split('/')) {
        const invalid = validateEntryName(name);
        if (invalid) throw new Error(invalid);
      }
      if (targetPath === args.relativePath || targetPath.startsWith(`${args.relativePath}/`))
        throw new Error('目标不能是原路径或其子目录');
    }
    const target = targetPath ? await resolveWithinCwd(args.rootPath, targetPath) : undefined;
    // 与正文保存共用路径锁；固定加锁顺序防止两个反向移动互相等待。
    const paths = [...new Set([source, ...(target ? [target] : [])])].toSorted();
    async function operation(): Promise<MutateEntryResult> {
      const entry = await inspect(workspace, args);
      if (entry.protectedReason) throw new Error(entry.protectedReason);
      if (entry.version !== args.expectedVersion) throw new Error('文件或目录在确认期间已变化，请重新打开操作');
      await assertRoot(workspace, args.rootPath);
      await resolveWithinCwd(args.rootPath, args.relativePath);
      if (args.operation === 'trash') {
        if (!ui) throw new Error('系统回收站不可用；没有删除文件');
        await ui.trashItem(source);
        return { ok: true };
      }
      if (!target || !targetPath) throw new Error('缺少目标路径');
      await resolveWithinCwd(args.rootPath, targetPath);
      try {
        await lstat(target);
        throw new Error('目标已经存在，不能覆盖');
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      }
      if (args.operation === 'duplicate') {
        if (entry.kind !== 'file') throw new Error('复制副本仅支持单个文件');
        if (/\.md$/i.test(args.relativePath)) {
          const document = await readDocumentSnapshot({ rootPath: args.rootPath, relativePath: args.relativePath });
          const content =
            document.head.status === 'ok' && document.head.frontmatter.id
              ? patchDocumentFields(document.content, { id: randomUUID() })
              : document.content;
          await createTextAtomically(target, content);
        } else await copyFile(source, target, constants.COPYFILE_EXCL);
      } else if (entry.kind === 'file') {
        // 硬链接的目标必须不存在。原文件删除前失败最多留下同内容副本，不会丢稿。
        await link(source, target);
        await unlink(source);
      } else {
        await rename(source, target);
      }
      return { ok: true, relativePath: targetPath };
    }
    const locked = (index: number): Promise<MutateEntryResult> =>
      index === paths.length ? operation() : withFileWriteLock(paths[index]!, () => locked(index + 1));
    return await locked(0);
  } catch (error) {
    return {
      ok: false,
      message: (error as NodeJS.ErrnoException).code === 'EEXIST' ? '目标已经存在，不能覆盖' : String(error)
    };
  }
}
