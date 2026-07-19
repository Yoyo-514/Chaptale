import { promises as fs } from 'node:fs';
import path from 'node:path';

import { readOptionalTextFile } from '../../infra/filesystem/files';
import { resolveAuthorMemoryPaths, resolveWorkspaceMemoryPaths } from './paths';

export type MemorySections = {
  /** ① 作者偏好要点：MEMORY.md 头部 + preferences 摘录。 */
  preferences?: string;
  /** ② 创作守则/禁忌：<workspace>/设定/创作守则.md。 */
  styleGuide?: string;
  /** ④ 近况：summaries/recent.md 头部。 */
  recent?: string;
  /** ⑤ notes 清单：文件名 + 首行，一行一条。 */
  notes?: string;
};

export type MemoryServiceOptions = {
  /** ~/.chaptale 根目录（SettingsService.rootDir）。 */
  chaptaleRootDir: string;
};

/** 单文件摘录的行数上限：注入块只取"头部要点"，全文靠 agent 用 read 深挖。 */
const HEAD_LINES_LIMIT = 20;
/** notes 清单条数上限，超出附提示行。 */
const NOTES_LIST_LIMIT = 30;

/**
 * 记忆读取服务（MC0：只读原语 + 目录约定）。
 *
 * 所有读取对"目录/文件不存在"静默降级为空——memory 从未初始化是常态；
 * 目录本身惰性创建（首次真正写入时由写方 mkdir），本服务不做启动铺目录。
 * 零 pi 依赖；写路径（notes 直写协议）走 agent 的 write 工具，不经本服务。
 */
export class MemoryService {
  constructor(private readonly options: MemoryServiceOptions) {}

  /** 读取注入块的四个数据节（v0：无资产快照节）。 */
  async readSections(cwd: string): Promise<MemorySections> {
    const authorPaths = resolveAuthorMemoryPaths(this.options.chaptaleRootDir);
    const workspacePaths = resolveWorkspaceMemoryPaths(cwd);

    const [memoryIndex, preferenceEntries, styleGuide, recent, notes] = await Promise.all([
      readOptionalTextFile(authorPaths.memoryIndex),
      readMarkdownHeads(authorPaths.preferencesDir),
      readOptionalTextFile(workspacePaths.styleGuide),
      readOptionalTextFile(workspacePaths.recent),
      listMarkdownFirstLines(workspacePaths.notesDir)
    ]);

    const preferences = joinNonEmpty([takeHead(memoryIndex), ...preferenceEntries]);

    return {
      ...(preferences ? { preferences } : {}),
      ...(styleGuide?.trim() ? { styleGuide: takeHead(styleGuide)! } : {}),
      ...(recent?.trim() ? { recent: takeHead(recent)! } : {}),
      ...(notes ? { notes } : {})
    };
  }
}

/** 取文本头部若干行（"要点"语义）；全文更长时截断并保持确定性输出。 */
function takeHead(text: string | undefined): string | undefined {
  const trimmed = text?.trim();

  if (!trimmed) {
    return undefined;
  }

  const lines = trimmed.split('\n');
  return lines.slice(0, HEAD_LINES_LIMIT).join('\n').trim();
}

/** 读取目录内全部 .md 的头部要点（按文件名排序保证确定性）。 */
async function readMarkdownHeads(dir: string): Promise<string[]> {
  const files = await listMarkdownFiles(dir);
  const heads = await Promise.all(files.map(async filePath => takeHead(await readOptionalTextFile(filePath))));

  return heads.filter((head): head is string => Boolean(head));
}

/** notes 清单：`文件名: 首行` 一行一条；超限截断附提示。 */
async function listMarkdownFirstLines(dir: string): Promise<string | undefined> {
  const files = await listMarkdownFiles(dir);

  if (files.length === 0) {
    return undefined;
  }

  const entries = await Promise.all(
    files.slice(0, NOTES_LIST_LIMIT).map(async filePath => {
      const content = await readOptionalTextFile(filePath);
      const firstLine = firstContentLine(content);
      return `${path.basename(filePath)}: ${firstLine}`;
    })
  );

  if (files.length > NOTES_LIST_LIMIT) {
    entries.push(`（共 ${files.length} 条，其余用 read 查看 ${dir}）`);
  }

  return entries.join('\n');
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(dir);
    return entries
      .filter(name => name.endsWith('.md'))
      .toSorted()
      .map(name => path.join(dir, name));
  } catch {
    return [];
  }
}

/** 跳过 frontmatter 与空行，取第一行正文作为清单摘要。 */
function firstContentLine(content: string | undefined): string {
  if (!content?.trim()) {
    return '（空）';
  }

  const body = content.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, '');
  const line = body.split(/\r?\n/).find(item => item.trim());
  return line?.trim() ?? '（空）';
}

function joinNonEmpty(parts: Array<string | undefined>): string | undefined {
  const joined = parts.filter(Boolean).join('\n\n').trim();
  return joined || undefined;
}
