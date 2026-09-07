import { presentableDiff } from '@codemirror/merge';
import { createHash } from 'node:crypto';
import { readdir } from 'node:fs/promises';

import type { ApplyCandidateArgs, WorkspaceDocument } from '@chaptale/ipc-contract';
import {
  applyDocumentEdits,
  CandidateValidator,
  normalizeDocumentText,
  type Candidate,
  type CandidateDetails,
  type CandidateStatus,
  type CandidateSummary
} from '@chaptale/shared';

import { createArtifact, resolveArtifactPath } from '../../core/workspace/artifacts';
import { writeTextAtomically } from '../../infra/filesystem/atomic-text';
import { withFileWriteLock } from '../../infra/filesystem/write-lock';
import { readDocumentSnapshot } from '../workspace/read-document';
import type { WorkspaceService } from '../workspace/service';
import { VersionStore } from './versions';

export function assertWritingTarget(targetPath: string) {
  if (!/\.(md|markdown)$/i.test(targetPath) || targetPath.split('/').some(part => part.startsWith('.'))) {
    throw new Error('候选只能修改作品 Markdown，不能修改内部记录');
  }
}
const transitions: Record<CandidateStatus, readonly CandidateStatus[]> = {
  preparing: ['generating', 'failed', 'cancelled'],
  generating: ['ready', 'failed', 'cancelled', 'stale'],
  ready: ['partially-accepted', 'accepted', 'discarded', 'stale'],
  'partially-accepted': ['partially-accepted', 'accepted', 'discarded', 'stale'],
  stale: ['discarded'],
  failed: ['discarded'],
  cancelled: ['discarded'],
  accepted: [],
  discarded: []
};
const candidatePath = (id: string) => {
  if (!/^[a-zA-Z0-9-]{1,80}$/.test(id)) throw new Error('候选 id 不合法');
  return `.chaptale/revisions/candidates/${id}.json`;
};
const hash = (content: string) => createHash('sha256').update(content).digest('hex');
const usable = (candidate: Candidate) => ['ready', 'partially-accepted'].includes(candidate.status);
export function candidateDetails(candidate: Candidate): CandidateDetails {
  const before = normalizeDocumentText(candidate.baselineContent);
  const after = normalizeDocumentText(candidate.proposedContent);
  const changes = presentableDiff(before, after, { scanLimit: 1000 }).map(change => ({
    fromA: change.fromA,
    toA: change.toA,
    fromB: change.fromB,
    toB: change.toB
  }));
  return { candidate, changes };
}
function transition(candidate: Candidate, status: CandidateStatus) {
  if (!transitions[candidate.status].includes(status))
    throw new Error(`候选状态不能从 ${candidate.status} 转为 ${status}`);
  candidate.status = status;
}

/** 候选 JSON 可变，模型输出与版本原文只增；所有状态变更按候选路径串行。 */
export class CandidateStore {
  constructor(
    private readonly workspace: Pick<WorkspaceService, 'readDocument' | 'writeDocument'>,
    readonly versions = new VersionStore()
  ) {}

  async create(rootPath: string, candidate: Candidate) {
    assertWritingTarget(candidate.targetPath);
    if (!CandidateValidator.Check(candidate) || hash(candidate.baselineContent) !== candidate.baselineHash)
      throw new Error('候选记录校验失败');
    await createArtifact(rootPath, candidatePath(candidate.id), JSON.stringify(candidate));
    return candidateDetails(candidate);
  }
  async list(rootPath: string) {
    const directory = await resolveArtifactPath(rootPath, '.chaptale/revisions/candidates');
    let names: string[];
    try {
      names = await readdir(directory);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { candidates: [], diagnostics: [] };
      throw error;
    }
    const candidates: CandidateSummary[] = [];
    const diagnostics: string[] = [];
    for (const name of names.filter(value => /^[a-zA-Z0-9-]+\.json$/.test(value))) {
      try {
        const { candidate } = await this.read(rootPath, name.slice(0, -5));
        const { id, revision, status, targetPath, goal, personaId, packId, createdAt, updatedAt, error, runId } =
          candidate;
        candidates.push({
          id,
          revision,
          status,
          targetPath,
          goal,
          personaId,
          packId,
          createdAt,
          updatedAt,
          ...(error ? { error } : {}),
          ...(runId ? { runId } : {})
        });
      } catch (error) {
        diagnostics.push(`${name}: ${String(error)}`);
      }
    }
    return { candidates: candidates.toSorted((a, b) => b.createdAt.localeCompare(a.createdAt)), diagnostics };
  }
  async read(rootPath: string, id: string) {
    return this.mutate(rootPath, id, async candidate => {
      const before = JSON.stringify(candidate);
      const current = await this.readTarget(rootPath, candidate.targetPath);
      if (candidate.applying) {
        if (current.ok && current.document.contentHash === candidate.applying.afterHash)
          this.confirmAcceptance(candidate);
        else if (current.ok && current.document.contentHash === candidate.baselineHash) delete candidate.applying;
        else {
          delete candidate.applying;
          if (usable(candidate)) transition(candidate, 'stale');
        }
      }
      if (usable(candidate) && (!current.ok || current.document.contentHash !== candidate.baselineHash))
        transition(candidate, 'stale');
      return { changed: before !== JSON.stringify(candidate) };
    });
  }
  async setStatus(
    rootPath: string,
    id: string,
    status: CandidateStatus,
    error?: string,
    run?: { runId: string; outputRef?: string }
  ) {
    return this.mutate(rootPath, id, async candidate => {
      transition(candidate, status);
      if (error) candidate.error = error;
      if (run) {
        candidate.runId = run.runId;
        if (run.outputRef) candidate.outputRef = run.outputRef;
      }
      return { changed: true };
    });
  }
  async finish(rootPath: string, id: string, output: string, runId: string, outputRef: string) {
    return this.mutate(rootPath, id, async candidate => {
      if (!output.trim() || output.length > 1_000_000) throw new Error('候选正文为空或超过长度上限');
      candidate.proposedContent = applyDocumentEdits(candidate.baselineContent, [
        { ...candidate.range, insert: output }
      ]);
      candidate.runId = runId;
      candidate.outputRef = outputRef;
      const current = await this.readTarget(rootPath, candidate.targetPath);
      transition(candidate, current.ok && current.document.contentHash === candidate.baselineHash ? 'ready' : 'stale');
      return { changed: true };
    });
  }
  async apply(args: ApplyCandidateArgs): Promise<{ details: CandidateDetails; document: WorkspaceDocument }> {
    const filename = await resolveArtifactPath(args.rootPath, candidatePath(args.candidateId));
    return withFileWriteLock(filename, async () => {
      const candidate = await this.readRaw(args.rootPath, args.candidateId);
      if (!usable(candidate) || candidate.applying) throw new Error('候选当前不可接受，请重新读取状态');
      if (candidate.revision !== args.revision) throw new Error('候选状态已更新，请重新查看差异');
      const current = await this.workspace.readDocument({
        rootPath: args.rootPath,
        relativePath: candidate.targetPath
      });
      if (!current.ok || current.document.contentHash !== candidate.baselineHash) {
        transition(candidate, 'stale');
        await this.persist(args.rootPath, candidate);
        throw new Error('正文已变化，候选已过期；请重新生成');
      }
      const details = candidateDetails(candidate);
      const indexes = [...new Set(args.changeIndexes)];
      if (
        !indexes.length ||
        indexes.some(index => !Number.isInteger(index) || index < 0 || index >= details.changes.length)
      )
        throw new Error('差异块选择无效');
      const bodyStart =
        current.document.head.status === 'ok'
          ? normalizeDocumentText(current.document.content).length -
            normalizeDocumentText(current.document.head.body).length
          : 0;
      if (indexes.some(index => details.changes[index]!.fromA < bodyStart)) throw new Error('候选不能修改 frontmatter');
      const proposed = normalizeDocumentText(candidate.proposedContent);
      const content = applyDocumentEdits(
        candidate.baselineContent,
        indexes.map(index => {
          const change = details.changes[index]!;
          return { from: change.fromA, to: change.toA, insert: proposed.slice(change.fromB, change.toB) };
        })
      );
      const afterHash = hash(content);
      await this.versions.save(current.document, 'accepted', candidate.id);
      candidate.applying = { content, afterHash, changes: indexes.length, at: new Date().toISOString() };
      await this.persist(args.rootPath, candidate);
      const result = await this.workspace.writeDocument({
        rootPath: args.rootPath,
        relativePath: candidate.targetPath,
        expectedHash: candidate.baselineHash,
        content
      });
      if (!result.ok) {
        // 写入后的读回也可能失败；保留意图，由下次读取按磁盘 hash 恢复。
        candidate.error = result.message;
        await this.persist(args.rootPath, candidate);
        throw new Error(result.message);
      }
      this.confirmAcceptance(candidate);
      await this.persist(args.rootPath, candidate);
      return { details: candidateDetails(candidate), document: result.document };
    });
  }
  private confirmAcceptance(candidate: Candidate) {
    const applying = candidate.applying!;
    candidate.acceptances.push({
      at: applying.at,
      beforeHash: candidate.baselineHash,
      afterHash: applying.afterHash,
      changes: applying.changes
    });
    candidate.baselineContent = applying.content;
    candidate.baselineHash = applying.afterHash;
    delete candidate.applying;
    delete candidate.error;
    transition(
      candidate,
      normalizeDocumentText(candidate.baselineContent) === normalizeDocumentText(candidate.proposedContent)
        ? 'accepted'
        : 'partially-accepted'
    );
  }
  private async readRaw(rootPath: string, id: string) {
    await resolveArtifactPath(rootPath, candidatePath(id));
    const document = await readDocumentSnapshot({
      rootPath,
      relativePath: candidatePath(id),
      maxBytes: 32 * 1024 * 1024
    });
    const value: unknown = JSON.parse(document.content);
    if (!CandidateValidator.Check(value) || value.id !== id || hash(value.baselineContent) !== value.baselineHash)
      throw new Error('候选记录损坏');
    assertWritingTarget(value.targetPath);
    if (value.applying && hash(value.applying.content) !== value.applying.afterHash)
      throw new Error('接受意图校验失败');
    return value;
  }
  private async readTarget(rootPath: string, relativePath: string) {
    try {
      return {
        ok: true as const,
        document: await readDocumentSnapshot({ rootPath, relativePath, maxBytes: 12 * 1024 * 1024 })
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { ok: false as const };
      throw error;
    }
  }
  private async persist(rootPath: string, candidate: Candidate) {
    candidate.revision += 1;
    candidate.updatedAt = new Date().toISOString();
    if (!CandidateValidator.Check(candidate)) throw new Error('候选状态校验失败');
    await writeTextAtomically(
      await resolveArtifactPath(rootPath, candidatePath(candidate.id)),
      JSON.stringify(candidate)
    );
  }
  private async mutate(rootPath: string, id: string, update: (candidate: Candidate) => Promise<{ changed: boolean }>) {
    const filename = await resolveArtifactPath(rootPath, candidatePath(id));
    return withFileWriteLock(filename, async () => {
      const candidate = await this.readRaw(rootPath, id);
      if ((await update(candidate)).changed) await this.persist(rootPath, candidate);
      return candidateDetails(candidate);
    });
  }
}
