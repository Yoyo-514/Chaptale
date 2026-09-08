import { promises as fs } from 'node:fs';

import { createArtifact } from '../../core/workspace/artifacts';
import { prepareSafeOutputFile, resolveExistingDirectJsonFile } from '../../infra/filesystem/safe-output-file';
import { readDocumentSnapshot } from '../workspace/read-document';

const REVIEW_OUTPUT_DIRECTORY = ['.chaptale', 'reviews'];

export type ReviewOutputStoreOptions = {
  /** 解析当前 workspace 根目录；read 无 cwd 参数时使用。 */
  resolveCwd: () => Promise<string> | string;
};

export type StoredReviewOutput = {
  kind: 'review';
  runId: string;
  output: unknown;
  contentHash: string;
};

/**
 * 审查结构化结果存储。
 *
 * reviews 目录只保存已校验的 reviewer outcome.value，文件内容不包 rawText，
 * 便于 Renderer 后续按领域结构直接读取。
 */
export class ReviewOutputStore {
  constructor(private readonly options: ReviewOutputStoreOptions) {}

  /** 排他创建不可变输出；同一 run 不能覆盖已经留档的结果。 */
  async save(runId: string, output: unknown, cwdOverride?: string): Promise<string> {
    const cwd = cwdOverride ?? (await this.options.resolveCwd());
    const target = await prepareSafeOutputFile(cwd, REVIEW_OUTPUT_DIRECTORY, runId);

    await createArtifact(cwd, target.outputRef, JSON.stringify(output));

    return target.outputRef;
  }

  /** 只读取 reviews 根目录下直接的 <runId>.json，拒绝状态文件、子目录与路径穿越。 */
  async read(outputRef: string): Promise<StoredReviewOutput | null> {
    const resolved = await this.resolveReviewFile(outputRef);

    if (!resolved) {
      return null;
    }

    try {
      const snapshot = await readDocumentSnapshot({
        rootPath: resolved.cwd,
        relativePath: outputRef,
        maxBytes: 8 * 1024 * 1024
      });
      const output: unknown = JSON.parse(snapshot.content);
      return { kind: 'review', runId: resolved.runId, output, contentHash: snapshot.contentHash };
    } catch {
      return null;
    }
  }

  /** 安全删除审查输出；非法 ref 与文件缺失都按幂等成功处理。 */
  async remove(outputRef: string, cwdOverride?: string): Promise<void> {
    const resolved = await this.resolveReviewFile(outputRef, cwdOverride);

    if (!resolved) {
      return;
    }

    await fs.rm(resolved.filePath, { force: true });
  }

  private async resolveReviewFile(
    outputRef: string,
    cwdOverride?: string
  ): Promise<{ filePath: string; runId: string; cwd: string } | null> {
    const cwd = cwdOverride ?? (await this.options.resolveCwd());
    const resolved = await resolveExistingDirectJsonFile(cwd, outputRef, REVIEW_OUTPUT_DIRECTORY);
    return resolved ? { ...resolved, cwd } : null;
  }
}
