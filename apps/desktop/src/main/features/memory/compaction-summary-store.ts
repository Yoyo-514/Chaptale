import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { resolveWorkspaceMemoryPaths } from './paths';

export type SaveCompactionSummaryInput = {
  sessionId: string;
  cwd: string;
  reason: 'manual' | 'threshold' | 'overflow';
  checkpointId: string;
  distillerRunId: string;
  memoryRefs: string[];
  summary: string;
  tokensBefore: number;
  createdAt?: string;
};

export type SaveCompactionSummaryResult = {
  /** workspace 相对引用，统一正斜杠。 */
  outputRef: string;
  /** 幂等重试命中旧文件时返回已落盘正文，保证会话树与 memory 完全一致。 */
  summary: string;
};

/**
 * 会话压缩前的创作检查点存储。
 *
 * 检查点先于 pi compaction 落盘：它负责跨会话检索与追溯，随后同一摘要才写入
 * 会话树。checkpointId 参与固定文件名，pi 写入失败后的重试不会制造重复副本。
 */
export class CompactionSummaryStore {
  async save(input: SaveCompactionSummaryInput): Promise<SaveCompactionSummaryResult> {
    const createdAt = input.createdAt ?? new Date().toISOString();
    const summariesDir = path.join(resolveWorkspaceMemoryPaths(input.cwd).summariesDir, 'compactions');
    const safeSessionId = sanitizeFilePart(input.sessionId);
    const digest = createHash('sha1').update(`${input.sessionId}\0${input.checkpointId}`).digest('hex').slice(0, 8);
    const fileName = `${safeSessionId}-${digest}.md`;
    const filePath = path.join(summariesDir, fileName);

    await fs.mkdir(summariesDir, { recursive: true });
    const existing = await readExisting(filePath);
    if (existing !== undefined) {
      return result(input.cwd, filePath, existing);
    }

    const tempPath = path.join(summariesDir, `.${fileName}.${randomUUID()}.tmp`);
    const content = renderSummaryFile(input, createdAt);
    let handle: Awaited<ReturnType<typeof fs.open>> | undefined;

    try {
      handle = await fs.open(tempPath, 'wx');
      await handle.writeFile(content, 'utf8');
      await handle.sync();
      await handle.close();
      handle = undefined;
      // hard link 以排他语义发布：目标已存在时必定失败，不能像 rename 一样跨平台覆盖胜者。
      await fs.link(tempPath, filePath);
      return result(input.cwd, filePath, input.summary.trim());
    } catch (error) {
      await handle?.close().catch(() => undefined);
      const raced = await readExisting(filePath);
      if (raced !== undefined) {
        return result(input.cwd, filePath, raced);
      }
      throw error;
    } finally {
      await fs.rm(tempPath, { force: true }).catch(() => undefined);
    }
  }
}

function result(cwd: string, filePath: string, summary: string): SaveCompactionSummaryResult {
  return {
    outputRef: path.relative(cwd, filePath).split(path.sep).join('/'),
    summary
  };
}

async function readExisting(filePath: string): Promise<string | undefined> {
  try {
    const content = await fs.readFile(filePath, 'utf8');
    const match = /^---\r?\n[\s\S]*?\r?\n---\r?\n+([\s\S]*)$/.exec(content);
    const summary = match?.[1]?.trim();
    if (!summary) {
      throw new Error(`已有会话检查点文件损坏：${filePath}`);
    }
    return summary;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
}

function renderSummaryFile(input: SaveCompactionSummaryInput, createdAt: string): string {
  const lines = [
    '---',
    'kind: summary',
    `title: ${JSON.stringify(`会话压缩：${input.sessionId}`)}`,
    `source: ${JSON.stringify(`session:${input.sessionId}`)}`,
    `createdAt: ${JSON.stringify(createdAt)}`,
    `reason: ${JSON.stringify(input.reason)}`,
    `checkpointId: ${JSON.stringify(input.checkpointId)}`,
    `distillerRunId: ${JSON.stringify(input.distillerRunId)}`,
    `memoryRefs: ${JSON.stringify(input.memoryRefs)}`,
    `tokensBefore: ${input.tokensBefore}`,
    '---',
    '',
    input.summary.trim(),
    ''
  ];

  return lines.join('\n');
}

/** 文件名仅保留可移植字符；会话 id 不参与路径拼接。 */
function sanitizeFilePart(value: string): string {
  const cleaned = value
    .replace(/[^a-zA-Z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 64);

  return cleaned || 'session';
}
