import { randomUUID } from 'node:crypto';
import { mkdir, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { stringify } from 'yaml';

import {
  CreateWorkspaceArgsValidator,
  type CreateWorkspaceArgs,
  type CreateWorkspaceResult
} from '@chaptale/ipc-contract';
import type { ChaptaleManifest, WorkspaceRole } from '@chaptale/shared';

import { DEFAULT_WORKSPACE_DIRS } from '../../core/workspace/layout';
import { createTextAtomically } from '../../infra/filesystem/atomic-text';
import { resolveWithinCwd } from '../../infra/filesystem/path-guard';
import { validateEntryName } from './entry-path';

/** 排他建立新作品，不复用已有目录；失败留下可诊断文件，绝不递归清理作者目录。 */
export async function createWorkspace(args: CreateWorkspaceArgs): Promise<CreateWorkspaceResult> {
  let partialPath: string | undefined;
  try {
    if (!CreateWorkspaceArgsValidator.Check([args])) throw new Error('作品信息不完整');
    const nameError = validateEntryName(args.directoryName);
    if (nameError || args.directoryName.startsWith('.')) throw new Error(nameError ?? '作品目录不能以点开头');
    if (!args.title.trim() || !args.title.isWellFormed() || /[\r\n\0]/.test(args.title))
      throw new Error('作品名称需要为一行有效文字');
    if (!args.styleGuide.isWellFormed() || args.styleGuide.includes('\0')) throw new Error('创作守则包含无效文字');
    if (!path.isAbsolute(args.parentPath)) throw new Error('请选择已有的绝对父目录');
    const parent = await realpath(args.parentPath);
    if (!(await stat(parent)).isDirectory()) throw new Error('存放位置不是目录');
    const rootPath = path.join(parent, args.directoryName);
    if (path.dirname(rootPath) !== parent) throw new Error('作品目录必须位于选定目录内');
    await mkdir(rootPath);
    partialPath = rootPath;
    const roles = new Set<WorkspaceRole>(['manuscript', 'world', ...args.roles]);
    const dirs: ChaptaleManifest['dirs'] = { ...DEFAULT_WORKSPACE_DIRS };
    for (const role of roles) await mkdir(await resolveWithinCwd(rootPath, DEFAULT_WORKSPACE_DIRS[role]));
    await mkdir(await resolveWithinCwd(rootPath, '.chaptale'));
    const files: string[] = [];
    async function write(relativePath: string, content: string) {
      await createTextAtomically(await resolveWithinCwd(rootPath, relativePath), content);
      files.push(relativePath);
    }
    const chapterPath = '正文/0001-第一章.md';
    const stylePath = '设定/创作守则.md';
    await write(
      stylePath,
      `---\n${stringify({ id: randomUUID(), kind: 'style', title: '创作守则' })}---\n# 创作守则\n\n${args.styleGuide.trim()}\n`
    );
    if (args.firstChapter) {
      await write(
        chapterPath,
        `---\n${stringify({
          id: randomUUID(),
          kind: 'chapter',
          title: '第一章',
          order: 1,
          status: 'draft',
          template: 'chapter'
        })}---\n# 第一章\n\n`
      );
    }
    const manifest: ChaptaleManifest = {
      version: 1,
      id: randomUUID(),
      title: args.title.trim(),
      kind: args.kind,
      dirs
    };
    // 清单最后写入，存在有效清单才意味着作品初始化完整。
    await write('chaptale.json', `${JSON.stringify(manifest, null, 2)}\n`);
    return { ok: true, rootPath, firstDocument: args.firstChapter ? chapterPath : stylePath, files };
  } catch (error) {
    return {
      ok: false,
      message:
        (error as NodeJS.ErrnoException).code === 'EEXIST'
          ? '同名目录已经存在，请更换目录名；没有覆盖任何已有文件。'
          : String(error),
      ...(partialPath ? { partialPath } : {})
    };
  }
}
