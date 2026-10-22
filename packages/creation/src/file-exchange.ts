import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open, readFile, readdir, unlink } from 'node:fs/promises';
import { basename, extname, isAbsolute, join } from 'node:path';
import { Type, type TSchema } from 'typebox';
import { Compile } from 'typebox/compile';

import type {
  CreationCommand,
  Entry,
  ExportFilesInput,
  ExportReport,
  ImportFilesInput,
  ImportPlan,
  ImportReport
} from './contracts.ts';
import type { CreationService } from './service.ts';

const id = Type.String({ minLength: 1 });
const nullableId = Type.Union([id, Type.Null()]);
const formatSchema = Type.Union([Type.Literal('txt'), Type.Literal('markdown')]);
const object = <T extends Record<string, TSchema>>(fields: T) => Type.Object(fields, { additionalProperties: false });
const source = {
  sourcePath: id,
  parentIndex: Type.Union([Type.Integer({ minimum: 0 }), Type.Null()]),
  title: Type.String()
};
const fileInputs = {
  prepareImport: object({ paths: Type.Array(id, { minItems: 1 }) }),
  importFiles: object({
    commandId: id,
    workId: id,
    parentId: nullableId,
    section: Type.Union([Type.Literal('manuscript'), Type.Literal('resource')]),
    entries: Type.Array(
      Type.Union([
        object({ ...source, kind: Type.Literal('directory'), format: Type.Null() }),
        object({ ...source, kind: Type.Literal('document'), format: formatSchema })
      ]),
      { minItems: 1 }
    ),
    skippedPaths: Type.Array(Type.String())
  }),
  exportFiles: object({
    workId: id,
    directory: id,
    target: Type.Union([
      object({ kind: Type.Literal('document'), documentId: id, format: formatSchema }),
      object({ kind: Type.Literal('manuscript'), format: formatSchema }),
      object({ kind: Type.Literal('book') })
    ])
  })
};
export const fileCommandValidator = Compile(
  Type.Union(Object.entries(fileInputs).map(([method, input]) => object({ method: Type.Literal(method), input })))
);
export type FileCommand = Extract<CreationCommand, { method: keyof typeof fileInputs }>;

function absolutePath(path: string): void {
  if (!isAbsolute(path)) throw new Error('文件交换需要绝对路径');
}

/** 原文件按 UTF-8 读取，保留 BOM、换行和尾部空白；解码失败时交给作者处理。 */
async function readOriginal(path: string): Promise<string> {
  const bytes = await readFile(path);
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new Error(`文件不是有效的 UTF-8 文本，请转换编码后重试：${path}`);
  }
}

export async function prepareImport(paths: string[]): Promise<ImportPlan> {
  const plan: ImportPlan = { commandId: randomUUID(), entries: [], skippedPaths: [] };
  const collator = new Intl.Collator('zh-CN', { numeric: true });
  async function visit(path: string, parentIndex: number | null): Promise<void> {
    absolutePath(path);
    const stat = await lstat(path);
    const extension = extname(path);
    const format =
      extension.toLowerCase() === '.txt'
        ? 'txt'
        : ['.md', '.markdown'].includes(extension.toLowerCase())
          ? 'markdown'
          : null;
    if (stat.isDirectory()) {
      const index = plan.entries.length;
      plan.entries.push({ sourcePath: path, parentIndex, title: basename(path), kind: 'directory', format: null });
      // readdir 返回本次独占的数组；项目 ES2022 类型库使用原地排序。
      // oxlint-disable-next-line unicorn/no-array-sort
      const names = (await readdir(path)).sort(collator.compare);
      for (const name of names) await visit(join(path, name), index);
    } else if (stat.isFile() && format) {
      plan.entries.push({ sourcePath: path, parentIndex, title: basename(path, extension), kind: 'document', format });
    } else {
      plan.skippedPaths.push(path);
    }
  }
  for (const path of paths) await visit(path, null);
  return plan;
}

export async function importFiles(service: CreationService, input: ImportFilesInput): Promise<ImportReport> {
  // 一次校验整份层级，拒绝无效计划后再开始产生业务提交。
  input.entries.forEach((entry, index) => {
    absolutePath(entry.sourcePath);
    if (
      entry.parentIndex !== null &&
      (entry.parentIndex >= index || input.entries[entry.parentIndex]!.kind !== 'directory')
    ) {
      throw new Error('导入计划的父目录必须位于子项之前');
    }
  });
  const report: ImportReport = { entries: [], failure: null };
  for (const [index, entry] of input.entries.entries()) {
    try {
      const parentId = entry.parentIndex === null ? input.parentId : report.entries[entry.parentIndex]!.id;
      const common = {
        commandId: `${input.commandId}:${index}`,
        workId: input.workId,
        parentId,
        section: input.section,
        title: entry.title
      };
      const created =
        entry.kind === 'directory'
          ? service.createEntry({ ...common, kind: 'directory' })
          : service.createEntry({
              ...common,
              kind: 'document',
              format: entry.format,
              content: await readOriginal(entry.sourcePath)
            });
      report.entries.push(created);
    } catch (error) {
      report.failure = { index, message: error instanceof Error ? error.message : '文件导入失败' };
      break;
    }
  }
  return report;
}

/** 只清理导出路径名称；标题和正文仍按保存的原字符输出。 */
function exportName(title: string): string {
  // Windows 文件名禁止控制字符，需和其他禁用字符一起替换。
  // oxlint-disable-next-line no-control-regex
  let name = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[ .]+$/, '');
  if (!name) throw new Error('标题无法生成有效文件名，请修改标题后导出');
  if (/^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³]|conin\$|conout\$)(?:\.|$)/i.test(name)) name = `_${name}`;
  return name;
}

async function writeExport(
  directory: string,
  title: string,
  extension: string,
  chunks: Iterable<string>
): Promise<string> {
  const name = exportName(title);
  for (let suffix = 1; ; suffix += 1) {
    const path = join(directory, `${name}${suffix === 1 ? '' : ` (${suffix})`}.${extension}`);
    const file = await open(path, 'wx').catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'EEXIST') return null;
      throw error;
    });
    if (!file) continue;
    let complete = false;
    try {
      for (const chunk of chunks) await file.writeFile(chunk, 'utf8');
      await file.close();
      complete = true;
      return path;
    } finally {
      if (!complete) {
        await file.close();
        await unlink(path);
      }
    }
  }
}

async function createExportDirectory(directory: string, title: string): Promise<string> {
  const name = exportName(title);
  for (let suffix = 1; ; suffix += 1) {
    const path = join(directory, `${name}${suffix === 1 ? '' : ` (${suffix})`}`);
    try {
      // 独占创建；已有目录也另起名称，避免合并两次导出的层级。
      await mkdir(path);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    }
  }
}

function manuscriptOrder(entries: Entry[]): Entry[] {
  const children = new Map<string | null, Entry[]>();
  for (const entry of entries) {
    if (entry.section !== 'manuscript') continue;
    const siblings = children.get(entry.parentId);
    if (siblings) siblings.push(entry);
    else children.set(entry.parentId, [entry]);
  }
  const ordered: Entry[] = [];
  function visit(parentId: string | null): void {
    for (const entry of children.get(parentId) ?? []) {
      ordered.push(entry);
      if (entry.kind === 'directory') visit(entry.id);
    }
  }
  // listEntries 已按同级 position 排序，深度优先展开保留目录顺序。
  visit(null);
  return ordered;
}

export async function exportFiles(service: CreationService, input: ExportFilesInput): Promise<ExportReport> {
  absolutePath(input.directory);
  const entries = service.listEntries(input.workId);
  const target = input.target;
  const selected =
    target.kind === 'document'
      ? entries.filter(entry => entry.id === target.documentId && entry.kind === 'document')
      : manuscriptOrder(entries);
  if (!selected.some(entry => entry.kind === 'document')) throw new Error('没有可导出的文稿或资料');
  const format = target.kind === 'book' ? 'txt' : target.format;
  // 导出固定所选修订，异步磁盘写入期间的保存不会混入这次输出。
  function* contents(items: Entry[]): Generator<string> {
    for (const [index, entry] of items.entries()) {
      if (index > 0) yield '\n\n';
      const revision = service.readRevision(input.workId, entry.revisionId);
      yield `${format === 'markdown' ? '# ' : ''}${revision.snapshot.title}`;
      if (entry.kind === 'document') {
        yield '\n\n';
        yield revision.snapshot.content!;
      }
    }
  }
  const report: ExportReport = { paths: [], failure: null };
  let currentDocument: string | null = null;
  try {
    if (target.kind === 'book') {
      const work = service.listWorks().find(candidate => candidate.id === input.workId)!;
      report.paths.push(await writeExport(input.directory, work.title, 'txt', contents(selected)));
    } else {
      const directories = new Map<string | null, string>([[null, input.directory]]);
      for (const entry of selected) {
        currentDocument = entry.kind === 'document' ? entry.id : null;
        const directory = target.kind === 'document' ? input.directory : directories.get(entry.parentId)!;
        if (entry.kind === 'directory') {
          directories.set(entry.id, await createExportDirectory(directory, entry.title));
        } else {
          report.paths.push(
            await writeExport(directory, entry.title, format === 'txt' ? 'txt' : 'md', contents([entry]))
          );
        }
      }
    }
  } catch (error) {
    report.failure = { documentId: currentDocument, message: error instanceof Error ? error.message : '文件导出失败' };
  }
  return report;
}
