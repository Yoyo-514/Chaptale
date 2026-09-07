import { createHash } from 'node:crypto';

import { RewriteSelectionValidator, type RewritePlan, type RewriteSelection } from '@chaptale/ipc-contract';
import { normalizeDocumentText, rewriteSpans, type ReviewDetails } from '@chaptale/shared';

import type { WorkspaceService } from '../workspace/service';
import { assertWritingTarget, type CandidateStore } from './candidates';

export type ReviewReader = (rootPath: string, id: string) => Promise<ReviewDetails>;
export async function prepareRewriteInput(
  args: RewriteSelection,
  dependencies: {
    readReview: ReviewReader;
    workspace: Pick<WorkspaceService, 'readDocument'>;
    candidates: Pick<CandidateStore, 'read'>;
  }
): Promise<{ plan: RewritePlan; baselineContent: string; sourceContent: string }> {
  if (!RewriteSelectionValidator.Check([args])) throw new Error('问题选择不合法');
  const { job, result, state } = await dependencies.readReview(args.rootPath, args.reviewId);
  if (!result || !state || job.status !== 'done') throw new Error('审查尚未完成');
  assertWritingTarget(job.targetPath);
  const indexes = [...new Set(args.issueIndexes)].toSorted((a, b) => a - b);
  const issues = indexes.map(index => {
    const issue = result.issues[index];
    if (!issue || (state.issues[String(index)]?.status ?? 'open') !== 'open')
      throw new Error('选中问题已处理或不存在，请重新选择');
    return issue;
  });
  const read = await dependencies.workspace.readDocument({
    rootPath: args.rootPath,
    relativePath: job.targetPath,
    maxBytes: 8 * 1024 * 1024
  });
  if (!read.ok) throw new Error(read.message);
  if (read.document.contentHash !== job.baselineHash) throw new Error('审查基线已变化，请重新审查');
  let sourceContent = read.document.content;
  if (job.candidateId) {
    const { candidate } = await dependencies.candidates.read(args.rootPath, job.candidateId);
    if (
      !['ready', 'partially-accepted', 'accepted'].includes(candidate.status) ||
      candidate.revision !== job.candidateRevision ||
      candidate.targetPath !== job.targetPath ||
      candidate.baselineHash !== job.baselineHash
    )
      throw new Error('被审查的候选已变化，请重新审查');
    sourceContent = candidate.proposedContent;
  }
  const sourceText = normalizeDocumentText(sourceContent);
  if (sourceText !== job.text) throw new Error('审查源文本已变化，请重新审查');
  const bodyStart =
    read.document.head.status === 'ok'
      ? normalizeDocumentText(read.document.content).length - normalizeDocumentText(read.document.head.body).length
      : 0;
  return {
    baselineContent: read.document.content,
    sourceContent,
    plan: {
      targetPath: job.targetPath,
      expectedHash: job.baselineHash,
      sourceHash: createHash('sha256').update(sourceContent).digest('hex'),
      outputHash: state.outputHash,
      sourceText,
      ...(job.candidateId ? { parentId: job.candidateId } : {}),
      ...(job.packId ? { packId: job.packId } : {}),
      issues,
      spans: rewriteSpans(sourceContent, issues, bodyStart)
    }
  };
}
