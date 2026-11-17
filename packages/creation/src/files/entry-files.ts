import { randomUUID } from 'node:crypto';
import { copyFile, mkdir, rm, stat } from 'node:fs/promises';
import { basename, isAbsolute, join } from 'node:path';

import type { AddFilesInput, AddFilesReport, FileLocation } from '../contracts/index.ts';
import type { CreationService } from '../service.ts';

/** 逐个复制到作品目录再登记条目；登记失败或重试命中旧回执时删除本次复制。 */
export async function addFiles(service: CreationService, input: AddFilesInput): Promise<AddFilesReport> {
  const report: AddFilesReport = { entries: [], failure: null };
  for (const [index, path] of input.paths.entries()) {
    const entryId = randomUUID();
    const dir = service.entryFileDir(input.workId, entryId);
    try {
      if (!isAbsolute(path)) throw new Error('添加文件需要绝对路径');
      if (!(await stat(path)).isFile()) throw new Error('只能添加文件，不能添加文件夹');
      const fileName = basename(path);
      await mkdir(dir, { recursive: true });
      await copyFile(path, join(dir, fileName));
      const entry = service.addFileEntry({
        commandId: `${input.commandId}:${index}`,
        workId: input.workId,
        parentId: input.parentId,
        entryId,
        fileName
      });
      if (entry.id !== entryId) await rm(dir, { recursive: true, force: true });
      report.entries.push(entry);
    } catch (error) {
      await rm(dir, { recursive: true, force: true });
      report.failure = { path, message: error instanceof Error ? error.message : '添加文件失败' };
      break;
    }
  }
  return report;
}

/** 创建并返回作品文件目录，供 Agent 会话作为工作目录。 */
export async function prepareWorkFiles(service: CreationService, workId: string): Promise<string> {
  const dir = service.workFilesDir(workId);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function locateFile(
  service: CreationService,
  workId: string,
  entryId: string,
  trashed: boolean
): Promise<FileLocation> {
  const entry = service.readFileEntry(workId, entryId, trashed);
  const path = join(service.entryFileDir(workId, entryId), entry.fileName!);
  const info = await stat(path).catch(() => {
    throw new Error(`文件已不存在：${path}`);
  });
  return { path, size: info.size, modifiedAt: info.mtimeMs };
}
