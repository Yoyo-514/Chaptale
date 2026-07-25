import { createHash } from 'node:crypto';
import { promises as fs, type Dirent } from 'node:fs';
import path from 'node:path';

import type { FrontmatterParser } from '../frontmatter/types';
import type { IndexDiagnostic, IndexSourceDocument, IndexSourceFile, IndexSourceRoot } from './types';

export type DiscoverIndexSourceFilesOptions = {
  cwd: string;
  roots: readonly IndexSourceRoot[];
};

export type DiscoverIndexSourceFilesResult = {
  files: IndexSourceFile[];
  fingerprint: string;
  diagnostics: IndexDiagnostic[];
};

export type ReadIndexSourceDocumentsOptions = {
  files: readonly IndexSourceFile[];
  parseFrontmatter: FrontmatterParser;
  readFile?: (filePath: string) => Promise<string>;
};

export type ReadIndexSourceDocumentsResult = {
  documents: IndexSourceDocument[];
  diagnostics: IndexDiagnostic[];
};

export type ScanIndexSourcesOptions = DiscoverIndexSourceFilesOptions & {
  parseFrontmatter: FrontmatterParser;
  readFile?: (filePath: string) => Promise<string>;
};

export type ScanIndexSourcesResult = {
  documents: IndexSourceDocument[];
  fingerprint: string;
  diagnostics: IndexDiagnostic[];
};

/**
 * 只读取目录项和 stat，供 warm cache 在不打开 Markdown 正文的情况下判断是否失效。
 * 单文件 stat 失败只进入诊断，不能阻断其余作品资产。
 */
export async function discoverIndexSourceFiles(
  options: DiscoverIndexSourceFilesOptions
): Promise<DiscoverIndexSourceFilesResult> {
  const cwd = path.resolve(options.cwd);
  const diagnostics: IndexDiagnostic[] = [];
  const files: IndexSourceFile[] = [];

  for (const root of options.roots) {
    for (const absolutePath of await collectMarkdownFiles(root.absolutePath, diagnostics, root.role)) {
      const sourcePath = toWorkspacePath(cwd, absolutePath);
      if (isConflictCopy(path.basename(absolutePath))) {
        diagnostics.push({ code: 'conflict-copy-skipped', message: '已跳过同步冲突副本', sourcePath, role: root.role });
        continue;
      }

      try {
        const stat = await fs.stat(absolutePath);
        files.push({
          sourcePath,
          absolutePath,
          domain: root.domain,
          role: root.role,
          size: stat.size,
          mtimeMs: stat.mtimeMs
        });
      } catch (error) {
        diagnostics.push({ code: 'source-stat-failed', message: toMessage(error), sourcePath, role: root.role });
      }
    }
  }

  files.sort((left, right) => left.sourcePath.localeCompare(right.sourcePath, 'zh-CN'));
  const fingerprint = createHash('sha256')
    .update(files.map(file => `${file.sourcePath}\0${file.size}\0${file.mtimeMs}`).join('\n'))
    .digest('hex');
  return { files, fingerprint, diagnostics };
}

/** 正文读取与 frontmatter 解析只在 cache miss 时执行。坏文件被跳过并进入诊断。 */
export async function readIndexSourceDocuments(
  options: ReadIndexSourceDocumentsOptions
): Promise<ReadIndexSourceDocumentsResult> {
  const diagnostics: IndexDiagnostic[] = [];
  const documents: IndexSourceDocument[] = [];
  const readFile = options.readFile ?? ((filePath: string) => fs.readFile(filePath, 'utf8'));

  for (const file of options.files) {
    let raw: string;
    try {
      raw = await readFile(file.absolutePath);
    } catch (error) {
      diagnostics.push({
        code: 'source-read-failed',
        message: toMessage(error),
        sourcePath: file.sourcePath,
        role: file.role
      });
      continue;
    }

    // frontmatter 损坏时仍索引原文；缓存是辅助能力，不应让一份坏元数据隐藏整篇正文。
    let body = raw;
    let frontmatter: Record<string, unknown> = {};
    try {
      ({ body, frontmatter } = options.parseFrontmatter(raw));
    } catch (error) {
      diagnostics.push({
        code: 'frontmatter-invalid',
        message: toMessage(error),
        sourcePath: file.sourcePath,
        role: file.role
      });
    }

    const status = asString(frontmatter.status);
    if (status?.toLowerCase() === 'archived') continue;
    const title = asString(frontmatter.title) ?? path.basename(file.sourcePath, path.extname(file.sourcePath));
    documents.push({
      sourcePath: file.sourcePath,
      domain: file.domain,
      role: file.role,
      title,
      ...(asString(frontmatter.kind) ? { kind: asString(frontmatter.kind) } : {}),
      ...(status ? { status } : {}),
      aliases: asStringArray(frontmatter.aliases),
      searchAliases: asStringArray(frontmatter.searchAliases),
      links: extractWikiLinks(body),
      body,
      size: file.size,
      mtimeMs: file.mtimeMs
    });
  }

  return { documents, diagnostics };
}

/** 为工具测试或批处理提供一次性快照；交互查询使用上面的两阶段 API。 */
export async function scanIndexSources(options: ScanIndexSourcesOptions): Promise<ScanIndexSourcesResult> {
  const discovered = await discoverIndexSourceFiles(options);
  const read = await readIndexSourceDocuments({
    files: discovered.files,
    parseFrontmatter: options.parseFrontmatter,
    ...(options.readFile ? { readFile: options.readFile } : {})
  });
  return {
    documents: read.documents,
    fingerprint: discovered.fingerprint,
    diagnostics: [...discovered.diagnostics, ...read.diagnostics]
  };
}

async function collectMarkdownFiles(
  rootPath: string,
  diagnostics: IndexDiagnostic[],
  role: IndexSourceRoot['role']
): Promise<string[]> {
  const files: string[] = [];
  let entries: Dirent<string>[];
  try {
    entries = await fs.readdir(rootPath, { withFileTypes: true, encoding: 'utf8' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
      diagnostics.push({ code: 'source-directory-failed', message: toMessage(error), role });
    }
    return files;
  }

  for (const entry of entries.toSorted((left, right) => left.name.localeCompare(right.name, 'zh-CN'))) {
    // 不跟随 symlink，既防 workspace 逃逸，也避免目录环。
    if (entry.isSymbolicLink()) continue;
    const entryPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) files.push(...(await collectMarkdownFiles(entryPath, diagnostics, role)));
    else if (entry.isFile() && path.extname(entry.name).toLowerCase() === '.md') files.push(entryPath);
  }
  return files;
}

function isConflictCopy(fileName: string): boolean {
  return /conflicted copy|sync-conflict|冲突副本|\(冲突\)/iu.test(fileName);
}

function toWorkspacePath(cwd: string, absolutePath: string): string {
  return path.relative(cwd, absolutePath).split(path.sep).join('/');
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function asStringArray(value: unknown): string[] {
  const values = Array.isArray(value) ? value : typeof value === 'string' ? [value] : [];
  return [
    ...new Set(
      values
        .filter((item): item is string => typeof item === 'string')
        .map(item => item.trim())
        .filter(Boolean)
    )
  ];
}

function extractWikiLinks(body: string): string[] {
  return [
    ...new Set(
      [...body.matchAll(/\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/gu)].map(match => match[1].trim()).filter(Boolean)
    )
  ];
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
