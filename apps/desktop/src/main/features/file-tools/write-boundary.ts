import { lstat, readFile } from 'node:fs/promises';

import { WorkspaceRelativePathValidator } from '@chaptale/shared';
import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { WorkspaceLayoutService } from '../../core/workspace/layout';
import { resolveWithinCwd } from '../../infra/filesystem/path-guard';

/** 通用文件工具只能产出草稿，授权规则不能绕过正文候选和资产确认。 */
export async function assertAgentDraftWrite(cwd: string, relativePath: string, content: string) {
  if (
    !WorkspaceRelativePathValidator.Check(relativePath) ||
    relativePath.split('/').some(part => part.startsWith('.')) ||
    !/\.(md|markdown|txt)$/i.test(relativePath)
  )
    throw new Error('文件工具只能写入草稿目录内的文本');
  const layout = await new WorkspaceLayoutService().read(cwd);
  const target = relativePath.toLowerCase();
  const within = (directory: string) => target.startsWith(`${directory.toLowerCase()}/`);
  if (
    !within(layout.roles.drafts.relativePath) ||
    ['manuscript', 'characters', 'world', 'threads', 'outline', 'templates'].some(role =>
      within(layout.roles[role as keyof typeof layout.roles].relativePath)
    )
  )
    throw new Error('正文修改必须使用候选稿，资产修改必须使用待确认提议；文件工具只写草稿目录');
  const parts = relativePath.split('/');
  for (let count = 1; count <= parts.length; count++) {
    const filename = await resolveWithinCwd(cwd, parts.slice(0, count).join('/'));
    try {
      if ((await lstat(filename)).isSymbolicLink()) throw new Error('草稿写入路径不能包含链接');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }
  const filename = await resolveWithinCwd(cwd, relativePath);
  let before = '';
  try {
    before = await readFile(filename, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  for (const text of [before, content]) {
    const head = parseDocumentFrontmatter(text);
    if (head.status === 'invalid' || (head.status === 'ok' && head.frontmatter.kind === 'chapter'))
      throw new Error('正式章节或损坏的元数据不能通过草稿工具改写');
  }
}
