import { promises as fs } from 'node:fs';

import { writeJsonAtomically } from '../../infra/filesystem/atomic-json';
import { prepareSafeOutputFile, resolveExistingDirectJsonFile } from '../../infra/filesystem/safe-output-file';

const REVIEW_OUTPUT_DIRECTORY = ['.chaptale', 'reviews'];

export type ReviewOutputStoreOptions = {
  /** 解析当前 workspace 根目录；read 无 cwd 参数时使用。 */
  resolveCwd: () => Promise<string> | string;
};

export type StoredReviewOutput = {
  kind: 'review';
  runId: string;
  output: unknown;
};

/**
 * 审查结构化结果存储。
 *
 * reviews 目录只保存已校验的 reviewer outcome.value，文件内容不包 rawText，
 * 便于 Renderer 后续按领域结构直接读取。
 */
export class ReviewOutputStore {
  constructor(private readonly options: ReviewOutputStoreOptions) {}

  /** 使用同目录临时文件 + rename 原子替换，避免半写 JSON 被读取。 */
  async save(runId: string, output: unknown, cwdOverride?: string): Promise<string> {
    const cwd = cwdOverride ?? (await this.options.resolveCwd());
    const target = await prepareSafeOutputFile(cwd, REVIEW_OUTPUT_DIRECTORY, runId);

    await writeJsonAtomically(target.filePath, output);

    return target.outputRef;
  }

  /** 只读取 reviews 根目录下直接的 <runId>.json，拒绝状态文件、子目录与路径穿越。 */
  async read(outputRef: string): Promise<StoredReviewOutput | null> {
    const resolved = await this.resolveReviewFile(outputRef);

    if (!resolved) {
      return null;
    }

    try {
      const output: unknown = JSON.parse(await fs.readFile(resolved.filePath, 'utf8'));
      return { kind: 'review', runId: resolved.runId, output };
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
  ): Promise<{ filePath: string; runId: string } | null> {
    const cwd = cwdOverride ?? (await this.options.resolveCwd());
    return resolveExistingDirectJsonFile(cwd, outputRef, REVIEW_OUTPUT_DIRECTORY);
  }
}
