import type { AddFilesReport, Entry } from '@chaptale/creation/contracts';

import { getDesktopApi } from '@/utils/desktop-api';

import { requestCreation } from '../request';

/** 添加文件的目标作品：当前目录条目、展开目标目录与刷新目录树由作品 store 提供。 */
export interface FileTarget {
  workId: string;
  entries: readonly Entry[];
  expand(parentId: string): void;
  refresh(): Promise<void>;
}

/** 按顺序添加到资料目录；中途失败时保留已添加的文件并报告失败项。返回添加的条目。 */
export async function addFiles(target: FileTarget, parentId: string | null, paths: string[]): Promise<Entry[]> {
  const report = await requestCreation('addFiles', {
    commandId: crypto.randomUUID(),
    workId: target.workId,
    parentId,
    paths
  });
  return added(target, parentId, report);
}

/** 正文插入的系统图片放进资料根目录的“插图”目录，没有时新建；没有本机路径的图片（如截图）按字节添加。 */
export async function addIllustrationFiles(target: FileTarget, files: File[]): Promise<Entry[]> {
  let directory = target.entries.find(
    entry =>
      entry.section === 'resource' && entry.parentId === null && entry.kind === 'directory' && entry.title === '插图'
  );
  directory ??= await requestCreation('createEntry', {
    commandId: crypto.randomUUID(),
    workId: target.workId,
    parentId: null,
    section: 'resource',
    kind: 'directory',
    title: '插图'
  });
  const api = getDesktopApi().creation;
  const result: Entry[] = [];
  for (const file of files) {
    const path = api.pathForFile(file);
    if (path) {
      result.push(...(await addFiles(target, directory.id, [path])));
      continue;
    }
    const extension = file.type.split('/')[1]?.replace('jpeg', 'jpg') ?? 'png';
    const report = await api.addFileData({
      workId: target.workId,
      parentId: directory.id,
      fileName: file.name || `粘贴的图片 ${new Date().toLocaleString('sv').replace(/:/g, '')}.${extension}`,
      data: new Uint8Array(await file.arrayBuffer())
    });
    result.push(...(await added(target, directory.id, report)));
  }
  return result;
}

async function added(target: FileTarget, parentId: string | null, report: AddFilesReport): Promise<Entry[]> {
  if (parentId) target.expand(parentId);
  await target.refresh();
  if (report.failure) {
    const name = report.failure.path.split(/[\\/]/).pop();
    throw new Error(`${name} 添加失败：${report.failure.message}`);
  }
  return report.entries;
}
