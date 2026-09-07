import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { AssetSnapshot } from '@chaptale/shared';

import { resolveAuthorMemoryPaths, resolveWorkspaceMemoryPaths } from '../../core/memory-layout/paths';
import { WorkspaceLayoutService } from '../../core/workspace/layout';
import { readOptionalTextFile } from '../../infra/filesystem/files';
import { resolveWithinCwd } from '../../infra/filesystem/path-guard';

export type MemorySections = {
  /** ① 作者偏好要点：MEMORY.md 头部 + preferences 摘录。 */
  preferences?: string;
  /** ② 创作守则/禁忌：<workspace>/设定/创作守则.md。 */
  styleGuide?: string;
  /** ④ 近况：summaries/recent.md 头部。 */
  recent?: string;
  /** ⑤ notes 清单：文件名 + 首行，一行一条。 */
  notes?: string;
  assets?: string;
  threads?: string;
};

export type MemoryServiceOptions = {
  /** ~/.chaptale 根目录（SettingsService.rootDir）。 */
  chaptaleRootDir: string;
  listAssets?: (cwd: string) => Promise<AssetSnapshot>;
};

/** 单文件摘录的行数上限：注入块只取"头部要点"，全文靠 agent 用 read 深挖。 */
const HEAD_LINES_LIMIT = 20;
/** notes 清单条数上限，超出附提示行。 */
const NOTES_LIST_LIMIT = 30;

/**
 * 记忆读取服务（只读原语 + 目录约定）。
 *
 * 所有读取对"目录/文件不存在"静默降级为空——memory 从未初始化是常态；
 * 目录本身惰性创建（首次真正写入时由写方 mkdir），本服务不做启动铺目录。
 * 写路径（notes 直写协议）走 agent 的 write 工具，不经本服务。
 */
export class MemoryService {
  constructor(private readonly options: MemoryServiceOptions) {}

  /** 读取注入块的四个数据节。 */
  async readSections(cwd: string): Promise<MemorySections> {
    const authorPaths = resolveAuthorMemoryPaths(this.options.chaptaleRootDir);
    const workspacePaths = resolveWorkspaceMemoryPaths(cwd);
    const layout = await new WorkspaceLayoutService().read(cwd);
    const stylePath = `${layout.roles.world.relativePath}/创作守则.md`;
    const readStyle = async () => readOptionalTextFile(await resolveWithinCwd(cwd, stylePath));

    const [memoryIndex, preferenceEntries, styleGuide, recent, notes, catalog] = await Promise.all([
      readOptionalTextFile(authorPaths.memoryIndex),
      readMarkdownHeads(authorPaths.preferencesDir),
      readStyle().catch(() => undefined),
      readOptionalTextFile(workspacePaths.recent),
      listMarkdownFirstLines(workspacePaths.notesDir),
      this.options.listAssets?.(cwd).catch(() => undefined)
    ]);

    const preferences = joinNonEmpty([takeHead(memoryIndex), ...preferenceEntries]);
    const assets =
      catalog?.assets.filter(
        asset => asset.status !== 'archived' && asset.role !== 'notes' && asset.role !== 'templates'
      ) ?? [];
    const threads = assets.filter(
      asset => asset.kind === 'plot-thread' && ['planted', 'advanced'].includes(asset.status ?? '')
    );
    const counts = new Map<string, number>();
    for (const asset of assets) counts.set(asset.kind ?? asset.role, (counts.get(asset.kind ?? asset.role) ?? 0) + 1);
    const characterLines = assets
      .filter(asset => asset.kind === 'character')
      .filter(
        (asset, _index, all) => all.length <= 20 || ['main', 'secondary'].includes(String(asset.frontmatter.importance))
      )
      .slice(0, 20)
      .map(asset => `${asset.title} | ${asset.sourcePath} | ${asset.excerpt.replaceAll('\n', ' ').slice(0, 80)}`);
    const assetIndex = assets.length
      ? `${[...counts].map(([kind, count]) => `${kind}: ${count}`).join(' · ')}\n${characterLines.join('\n')}\n完整内容按需通过 memory_search/read 获取。`
      : undefined;

    return {
      ...(preferences ? { preferences } : {}),
      ...(styleGuide?.trim() ? { styleGuide: `来源：${stylePath}\n${takeHead(styleGuide)!}` } : {}),
      ...(recent?.trim() ? { recent: takeHead(recent)! } : {}),
      ...(notes ? { notes } : {}),
      ...(assetIndex ? { assets: assetIndex } : {}),
      ...(threads.length
        ? {
            threads: threads
              .map(
                asset =>
                  `${asset.title} | ${asset.status} | ${asset.sourcePath} | 埋设 ${String(asset.frontmatter.plantedAt ?? '未登记')} | 揭露限制 ${String(asset.frontmatter.mustNotRevealBefore ?? '未登记')}`
              )
              .join('\n')
          }
        : {})
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
  const files = (await listMarkdownFiles(dir)).filter(
    filePath => !/^review-[a-f0-9]{64}\.md$/.test(path.basename(filePath))
  );
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
      return `${path.basename(filePath)}: ${firstLine.slice(0, 200)}`;
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
