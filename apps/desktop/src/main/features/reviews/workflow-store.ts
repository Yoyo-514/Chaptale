import { readdir } from 'node:fs/promises';

import {
  REVIEWERS,
  ReviewJobValidator,
  ReviewStateValidator,
  decodeReviewIssues,
  type IssueStatus,
  type ReviewDetails,
  type ReviewJob,
  type ReviewJobSummary
} from '@chaptale/shared';

import { createArtifact, resolveArtifactPath } from '../../core/workspace/artifacts';
import { writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { readDocumentSnapshot } from '../workspace/read-document';

function jobPath(id: string) {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('审查 id 不合法');
  return `.chaptale/reviews/jobs/${id}.json`;
}
export class ReviewWorkflowStore {
  async create(rootPath: string, job: ReviewJob) {
    if (!ReviewJobValidator.Check(job)) throw new Error('审查任务校验失败');
    await createArtifact(rootPath, jobPath(job.id), JSON.stringify(job));
  }
  async update(
    rootPath: string,
    id: string,
    patch: Partial<Pick<ReviewJob, 'status' | 'runId' | 'outputRef' | 'error'>>
  ) {
    const filename = await resolveArtifactPath(rootPath, jobPath(id));
    await withFileWriteLock(filename, async () => {
      const job = await this.readJob(rootPath, id);
      const updated = { ...job, ...patch, updatedAt: new Date().toISOString() };
      if (patch.status === 'done') {
        const { document } = await this.readOutput(rootPath, updated);
        updated.outputHash = document.contentHash;
      }
      if (!ReviewJobValidator.Check(updated)) throw new Error('审查状态校验失败');
      await writeTextAtomically(filename, JSON.stringify(updated));
    });
  }
  async list(rootPath: string) {
    let names: string[];
    try {
      names = await readdir(await resolveArtifactPath(rootPath, '.chaptale/reviews/jobs'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { jobs: [], diagnostics: [] };
      throw error;
    }
    const jobs: ReviewJobSummary[] = [];
    const diagnostics: string[] = [];
    for (const name of names.filter(value => /^[a-zA-Z0-9-]+\.json$/.test(value))) {
      try {
        const { text: _text, ...job } = await this.readJob(rootPath, name.slice(0, -5));
        jobs.push(job);
      } catch (error) {
        diagnostics.push(`${name}: ${String(error)}`);
      }
    }
    return { jobs: jobs.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)), diagnostics };
  }
  async readJob(rootPath: string, id: string): Promise<ReviewJob> {
    await resolveArtifactPath(rootPath, jobPath(id));
    const document = await readDocumentSnapshot({ rootPath, relativePath: jobPath(id), maxBytes: 32 * 1024 * 1024 });
    const job: unknown = JSON.parse(document.content);
    if (!ReviewJobValidator.Check(job) || job.id !== id) throw new Error('审查记录损坏');
    return job;
  }
  async read(rootPath: string, id: string): Promise<ReviewDetails> {
    const job = await this.readJob(rootPath, id);
    if (job.status !== 'done') return { job, result: null, state: null };
    const { document, result } = await this.readOutput(rootPath, job);
    if (job.outputHash && job.outputHash !== document.contentHash) throw new Error('审查输出已被修改，请重审');
    const statePath = `.chaptale/reviews/${job.runId}.state.json`;
    await resolveArtifactPath(rootPath, statePath);
    try {
      const stateDocument = await readDocumentSnapshot({ rootPath, relativePath: statePath, maxBytes: 1024 * 1024 });
      const state: unknown = JSON.parse(stateDocument.content);
      if (!ReviewStateValidator.Check(state) || state.outputHash !== document.contentHash)
        throw new Error('审查输出或处理状态已被修改，请重审');
      return { job, result, state };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
      return { job, result, state: { outputHash: document.contentHash, issues: {} } };
    }
  }
  private async readOutput(rootPath: string, job: ReviewJob) {
    if (!job.runId || job.outputRef !== `.chaptale/reviews/${job.runId}.json`) throw new Error('审查输出引用不合法');
    await resolveArtifactPath(rootPath, job.outputRef);
    const document = await readDocumentSnapshot({ rootPath, relativePath: job.outputRef, maxBytes: 8 * 1024 * 1024 });
    const kind = REVIEWERS.find(reviewer => reviewer.id === job.personaId)!.kind;
    const result = decodeReviewIssues(kind, JSON.parse(document.content));
    if (!result || result.issues.length > 1000) throw new Error('审查输出未通过校验');
    return { document, result };
  }
  async resolve(rootPath: string, id: string, indexes: number[], status: IssueStatus) {
    const job = await this.readJob(rootPath, id);
    if (!job.runId) throw new Error('审查尚未完成');
    const filename = await resolveArtifactPath(rootPath, `.chaptale/reviews/${job.runId}.state.json`);
    return withFileWriteLock(filename, async () => {
      const details = await this.read(rootPath, id);
      if (
        !details.result ||
        !details.state ||
        !indexes.length ||
        indexes.some(index => !Number.isInteger(index) || index < 0 || index >= details.result!.issues.length)
      )
        throw new Error('问题选择无效');
      const now = new Date().toISOString();
      for (const index of indexes) {
        if (details.state.issues[String(index)]?.status !== status) {
          details.state.issues[String(index)] = { status, updatedAt: now };
        }
      }
      await writeTextAtomically(filename, JSON.stringify(details.state));
      return details;
    });
  }
}
