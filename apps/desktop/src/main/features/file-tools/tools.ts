import { writeFile } from 'atomically';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { Type } from 'typebox';

import type { ToolDefinition } from '../../core/tool-protocol/definition';
import { DEFAULT_IGNORED_DIRS, globToRegExp, isBinaryContent, resolveWithinCwd } from './path-guard';

/**
 * 文件六工具装配：全部绑定同一会话 cwd，共享越界守卫。
 *
 * 执行异常不在此层吞掉：抛出后由 AI SDK 转 `tool-error`，引擎统一落盘为
 * `isError: true` 的配对结果（`core/agent/engine.ts`）。此前这里有一层
 * `wrapWithErrorText` 把异常转成"成功但正文是错误文本"的结果——模型能看懂，
 * 但失败标记被抹平，UI 与历史里这六个工具永远显示为成功。
 */
export function createFileTools(cwd: string): ToolDefinition[] {
  return [
    createReadTool(cwd),
    createGrepTool(cwd),
    createFindTool(cwd),
    createLsTool(cwd),
    createWriteTool(cwd),
    createEditTool(cwd)
  ];
}

const readParameters = Type.Object(
  {
    path: Type.String({ description: '相对会话目录的文件路径' }),
    offset: Type.Optional(Type.Integer({ minimum: 1, description: '起始行号（1 起），默认 1' })),
    limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 2000, description: '读取行数，默认 500' }))
  },
  { additionalProperties: false }
);

const READ_DEFAULT_LIMIT = 500;
const MAX_LINE_LENGTH = 2000;
/** 单文件整体读取上限：read/grep 对超大文件只读头部预算，避免内存爆炸。 */
const MAX_TOOL_FILE_BYTES = 100 * 1024 * 1024;

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

/** read：分页读文本文件；二进制拒读；超长行截断；带行号输出。 */
export function createReadTool(cwd: string): ToolDefinition<typeof readParameters> {
  return {
    name: 'read',
    label: '读取文件',
    riskLevel: 'readonly',
    description: '读取文本文件内容，带行号分页输出。二进制文件（PDF/图片等）不支持直接读取。',
    parameters: readParameters,
    async execute(params) {
      const filePath = await resolveWithinCwd(cwd, params.path);

      let stat;

      try {
        stat = await fs.stat(filePath);
      } catch {
        return { text: `文件不存在：${params.path}` };
      }

      if (!stat.isFile()) {
        return { text: `不是文件：${params.path}` };
      }

      if (stat.size > MAX_TOOL_FILE_BYTES) {
        return {
          text: `文件过大（${formatBytes(stat.size)}，上限 ${formatBytes(MAX_TOOL_FILE_BYTES)}），不支持直接读取：${params.path}`
        };
      }

      const buffer = await fs.readFile(filePath);

      if (isBinaryContent(buffer)) {
        return { text: `二进制文件不支持直接读取：${params.path}` };
      }

      const allLines = buffer.toString('utf8').split('\n');
      const totalLines = allLines.length;
      const offset = params.offset ?? 1;
      const limit = params.limit ?? READ_DEFAULT_LIMIT;
      const endLine = Math.min(offset - 1 + limit, totalLines);
      const numbered = allLines
        .slice(offset - 1, endLine)
        .map((line, index) => `${offset + index}`.padStart(6) + ' ' + truncateLine(line))
        .join('\n');

      const header =
        endLine < totalLines
          ? `文件共 ${totalLines} 行，已显示第 ${offset}-${endLine} 行；继续读取请传入 offset=${endLine + 1}。`
          : `文件共 ${totalLines} 行（第 ${offset}-${endLine} 行）。`;

      return { text: `${header}\n${numbered}` };
    }
  };
}

function truncateLine(line: string): string {
  return line.length > MAX_LINE_LENGTH ? `${line.slice(0, MAX_LINE_LENGTH)}…（超长行已截断）` : line;
}

const grepParameters = Type.Object(
  {
    pattern: Type.String({ description: '搜索内容；regex 为 true 时按正则解释' }),
    regex: Type.Optional(Type.Boolean({ description: '按正则搜索，默认按字面量' })),
    path: Type.Optional(Type.String({ description: '搜索起点（文件或目录），默认会话目录' })),
    include: Type.Optional(Type.String({ description: '文件名 glob 过滤，如 *.md' })),
    maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 500, description: '命中上限，默认 100' }))
  },
  { additionalProperties: false }
);

const GREP_DEFAULT_MAX = 100;

/** grep：内容搜索；输出 file:line: text；跳过二进制与噪声目录；支持取消。 */
export function createGrepTool(cwd: string): ToolDefinition<typeof grepParameters> {
  return {
    name: 'grep',
    label: '内容搜索',
    riskLevel: 'readonly',
    description: '在文件内容中搜索文本或正则，返回文件名、行号与命中行。',
    parameters: grepParameters,
    async execute(params, signal) {
      const root = await resolveWithinCwd(cwd, params.path ?? '.');
      const matcher = createMatcher(params.pattern, params.regex ?? false);
      const include = params.include ? new RegExp(`^${globToRegExp(params.include).source.slice(1, -1)}$`) : undefined;
      const maxResults = params.maxResults ?? GREP_DEFAULT_MAX;

      const hits: string[] = [];
      let scannedFiles = 0;
      let skippedLargeFiles = 0;
      let truncated = false;

      await walk(
        root,
        signal,
        async filePath => {
          if (include && !include.test(path.basename(filePath))) {
            return;
          }

          const stat = await fs.stat(filePath).catch(() => undefined);

          if (!stat?.isFile() || stat.size > MAX_TOOL_FILE_BYTES) {
            if (stat && stat.size > MAX_TOOL_FILE_BYTES) {
              skippedLargeFiles += 1;
            }
            return;
          }

          const buffer = await fs.readFile(filePath).catch(() => undefined);

          if (!buffer || isBinaryContent(buffer)) {
            return;
          }

          scannedFiles += 1;
          const lines = buffer.toString('utf8').split('\n');

          for (const [index, line] of lines.entries()) {
            if (matcher(line)) {
              if (hits.length >= maxResults) {
                truncated = true;
                return;
              }

              hits.push(
                `${path.relative(cwd, filePath).replace(/\\/g, '/')}:${index + 1}: ${line.trim().slice(0, 300)}`
              );
            }
          }
        },
        () => hits.length >= maxResults
      );

      if (hits.length === 0) {
        const skippedNote = skippedLargeFiles > 0 ? `（跳过 ${skippedLargeFiles} 个超大文件）` : '';
        return { text: `未找到匹配：${params.pattern}（扫描 ${scannedFiles} 个文件${skippedNote}）` };
      }

      const footer = truncated
        ? `\n（已达 ${maxResults} 条上限，命中被截断${skippedLargeFiles > 0 ? `；跳过 ${skippedLargeFiles} 个超大文件` : ''}）`
        : skippedLargeFiles > 0
          ? `\n（跳过 ${skippedLargeFiles} 个超大文件）`
          : '';

      return { text: `${hits.join('\n')}${footer}` };
    }
  };
}

function createMatcher(pattern: string, isRegex: boolean): (line: string) => boolean {
  if (!isRegex) {
    return line => line.includes(pattern);
  }

  let regex: RegExp;

  try {
    regex = new RegExp(pattern);
  } catch (error) {
    throw new Error(`正则表达式无效：${(error as Error).message}`, { cause: error });
  }

  return line => regex.test(line);
}

const findParameters = Type.Object(
  {
    pattern: Type.String({ description: '文件名 glob，如 *.md 或 **/*.json' }),
    path: Type.Optional(Type.String({ description: '搜索起点目录，默认会话目录' })),
    maxResults: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000, description: '结果上限，默认 200' }))
  },
  { additionalProperties: false }
);

const FIND_DEFAULT_MAX = 200;

/** find：文件名 glob 递归查找；相对路径与 basename 双匹配（*.md 也命中子目录）。 */
export function createFindTool(cwd: string): ToolDefinition<typeof findParameters> {
  return {
    name: 'find',
    label: '查找文件',
    riskLevel: 'readonly',
    description: '按文件名 glob 递归查找文件，返回相对路径列表。',
    parameters: findParameters,
    async execute(params, signal) {
      const root = await resolveWithinCwd(cwd, params.path ?? '.');
      const matcher = globToRegExp(params.pattern.replace(/\\/g, '/'));
      const maxResults = params.maxResults ?? FIND_DEFAULT_MAX;

      const results: string[] = [];
      let truncated = false;

      await walk(
        root,
        signal,
        async filePath => {
          const relative = path.relative(cwd, filePath).replace(/\\/g, '/');

          if (matcher.test(relative) || matcher.test(path.basename(filePath))) {
            if (results.length >= maxResults) {
              truncated = true;
              return;
            }

            results.push(relative);
          }
        },
        () => results.length >= maxResults
      );

      if (results.length === 0) {
        return { text: `未找到匹配文件：${params.pattern}` };
      }

      const footer = truncated ? `\n（已达 ${maxResults} 条上限）` : '';

      return { text: `${results.join('\n')}${footer}` };
    }
  };
}

const lsParameters = Type.Object(
  {
    path: Type.Optional(Type.String({ description: '目录路径，默认会话目录' }))
  },
  { additionalProperties: false }
);

/** ls：目录清单，目录在前 + 名称排序，目录以 / 结尾。 */
export function createLsTool(cwd: string): ToolDefinition<typeof lsParameters> {
  return {
    name: 'ls',
    label: '列出目录',
    riskLevel: 'readonly',
    description: '列出目录内容；目录以 / 结尾标记。',
    parameters: lsParameters,
    async execute(params) {
      const dir = await resolveWithinCwd(cwd, params.path ?? '.');
      let entries;

      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return { text: `目录不存在：${params.path ?? '.'}` };
      }

      const formatted = entries
        .map(entry => ({ name: entry.name + (entry.isDirectory() ? '/' : ''), isDir: entry.isDirectory() }))
        .toSorted((left, right) =>
          left.isDir === right.isDir ? left.name.localeCompare(right.name) : left.isDir ? -1 : 1
        )
        .map(entry => entry.name);

      return { text: formatted.length === 0 ? '目录为空' : formatted.join('\n') };
    }
  };
}

const writeParameters = Type.Object(
  {
    path: Type.String({ description: '相对会话目录的文件路径' }),
    content: Type.String({ description: '写入的完整内容（整体覆盖）' })
  },
  { additionalProperties: false }
);

/** write：整体覆盖式原子写（temp + rename），父目录自动创建。 */
export function createWriteTool(cwd: string): ToolDefinition<typeof writeParameters> {
  return {
    name: 'write',
    label: '写入文件',
    riskLevel: 'mutating',
    description: '把内容整体写入文件（覆盖已有内容），父目录不存在时自动创建。',
    parameters: writeParameters,
    async execute(params) {
      const filePath = await resolveWithinCwd(cwd, params.path);
      const bytes = Buffer.byteLength(params.content, 'utf8');

      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await writeFile(filePath, params.content, { encoding: 'utf8' });

      return {
        text: `已写入 ${params.path}（${bytes} 字节，整体覆盖）`,
        details: { path: params.path, bytes }
      };
    }
  };
}

const editParameters = Type.Object(
  {
    path: Type.String({ description: '相对会话目录的文件路径' }),
    oldText: Type.String({ description: '被替换的原文；必须在文件中恰好出现一次' }),
    newText: Type.String({ description: '替换后的新文本' })
  },
  { additionalProperties: false }
);

/** edit：oldText 恰好出现一次才替换；零匹配/多匹配给出次数提示（原子写）。 */
export function createEditTool(cwd: string): ToolDefinition<typeof editParameters> {
  return {
    name: 'edit',
    label: '编辑文件',
    riskLevel: 'mutating',
    description: '精确文本替换：oldText 必须在文件中恰好出现一次，否则报错并给出出现次数。',
    parameters: editParameters,
    async execute(params) {
      const filePath = await resolveWithinCwd(cwd, params.path);

      let content: string;

      try {
        const buffer = await fs.readFile(filePath);

        if (isBinaryContent(buffer)) {
          return { text: `二进制文件不支持编辑：${params.path}` };
        }

        content = buffer.toString('utf8');
      } catch {
        return { text: `文件不存在：${params.path}` };
      }

      const count = countOccurrences(content, params.oldText);

      if (count === 0) {
        return { text: '未找到要替换的文本（oldText 出现 0 次）。请核对原文并重试。' };
      }

      if (count > 1) {
        return { text: `oldText 出现 ${count} 次，无法确定替换目标。请扩大 oldText 范围使其唯一。` };
      }

      await writeFile(filePath, content.replace(params.oldText, params.newText), { encoding: 'utf8' });

      return {
        text: `已替换 ${params.path} 中 1 处文本`,
        details: { path: params.path, occurrences: 1 }
      };
    }
  };
}

function countOccurrences(content: string, needle: string): number {
  if (!needle) {
    return 0;
  }

  let count = 0;
  let index = content.indexOf(needle);

  while (index !== -1) {
    count += 1;
    index = content.indexOf(needle, index + needle.length);
  }

  return count;
}

/**
 * 深度优先遍历：跳过噪声目录；signal 中止时终止；
 * 命中上限由调用方在 visit 内自行截断（简单优先，不做双重控制流）。
 */
async function walk(
  root: string,
  signal: AbortSignal | undefined,
  visit: (filePath: string) => Promise<void>,
  shouldStop?: () => boolean
): Promise<void> {
  let entries;

  try {
    const stat = await fs.stat(root);

    if (stat.isFile()) {
      await visit(root);
      return;
    }

    entries = await fs.readdir(root, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (signal?.aborted || shouldStop?.()) {
      return;
    }

    const full = path.join(root, entry.name);

    if (entry.isDirectory()) {
      if (DEFAULT_IGNORED_DIRS.has(entry.name)) {
        continue;
      }

      await walk(full, signal, visit, shouldStop);
    } else if (entry.isFile()) {
      await visit(full);

      // visit 可能刚把计数推到上限：立即停止，避免继续扫描剩余目录树。
      if (shouldStop?.()) {
        return;
      }
    }
  }
}
