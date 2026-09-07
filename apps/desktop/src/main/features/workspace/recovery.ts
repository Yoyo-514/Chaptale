import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import {
  MAX_DOCUMENT_BYTES,
  RecoveryDraftValidator,
  type RecoveryDraft,
  type RecoverySummary,
  type SaveRecoveryArgs
} from '@chaptale/ipc-contract';

import { writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';

const hash = (value: string) => createHash('sha256').update(value).digest('hex');

/** 恢复草稿在本机缓存，按工作区与相对路径隔离，不写回作者文件。 */
export class RecoveryStore {
  constructor(private readonly cacheRoot: string) {}

  private directory(rootPath: string) {
    const absolute = path.resolve(rootPath);
    return path.join(
      this.cacheRoot,
      'editor-recovery',
      hash(process.platform === 'win32' ? absolute.toLowerCase() : absolute)
    );
  }

  private target(rootPath: string, relativePath: string) {
    return path.join(this.directory(rootPath), `${hash(relativePath)}.json`);
  }

  async save(args: SaveRecoveryArgs) {
    const sizeBytes = Buffer.byteLength(args.content);
    if (sizeBytes > MAX_DOCUMENT_BYTES || !args.content.isWellFormed() || args.content.includes('\0')) {
      throw new Error('恢复草稿不是受支持的 UTF-8 文本或超过大小限制');
    }
    const target = this.target(args.rootPath, args.relativePath);
    await withFileWriteLock(target, async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeTextAtomically(target, JSON.stringify({ ...args, updatedAt: new Date().toISOString(), sizeBytes }));
    });
  }

  async read(rootPath: string, relativePath: string): Promise<RecoveryDraft | null> {
    try {
      const value: unknown = JSON.parse(await readFile(this.target(rootPath, relativePath), 'utf8'));
      return RecoveryDraftValidator.Check(value) && value.rootPath === rootPath && value.relativePath === relativePath
        ? value
        : null;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null;
      throw error;
    }
  }

  async list(rootPath: string): Promise<RecoverySummary[]> {
    let files: string[];
    try {
      files = await readdir(this.directory(rootPath));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
      throw error;
    }
    const drafts: RecoverySummary[] = [];
    for (const file of files.filter(name => /^[a-f0-9]{64}\.json$/.test(name))) {
      try {
        const value: unknown = JSON.parse(await readFile(path.join(this.directory(rootPath), file), 'utf8'));
        if (RecoveryDraftValidator.Check(value) && value.rootPath === rootPath) {
          const { content: _content, ...summary } = value;
          drafts.push(summary);
        }
      } catch {
        /* 损坏的缓存留在原处，不覆盖仍可手工抢救的内容。 */
      }
    }
    return drafts.toSorted((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async discard(rootPath: string, relativePath: string) {
    const target = this.target(rootPath, relativePath);
    await withFileWriteLock(target, () => rm(target, { force: true }));
  }

  async preserve(rootPath: string, relativePath: string, content: string) {
    const target = path.join(this.directory(rootPath), 'conflicts', `${hash(relativePath)}-${hash(content)}.json`);
    await withFileWriteLock(target, async () => {
      await mkdir(path.dirname(target), { recursive: true });
      await writeTextAtomically(target, JSON.stringify({ relativePath, content, savedAt: new Date().toISOString() }));
    });
  }
}
