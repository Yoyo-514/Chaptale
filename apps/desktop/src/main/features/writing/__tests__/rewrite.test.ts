import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { applyRewriteEdits, normalizeDocumentText, type Candidate, type ReviewJob } from '@chaptale/shared';

import { ReviewWorkflowStore } from '../../reviews/workflow-store';
import { WorkspaceService } from '../../workspace/service';
import { CandidateStore } from '../candidates';
import { prepareRewriteInput } from '../rewrite';

let root: string;
let reviews: ReviewWorkflowStore;
let workspace: WorkspaceService;
let candidates: CandidateStore;
const text = '\uFEFF前言。\r\n林晚慢慢走进门。\n尾声。\r';
const hash = (value: string) => createHash('sha256').update(value).digest('hex');
async function review(candidate?: Candidate) {
  const now = new Date().toISOString();
  const job: ReviewJob = {
    id: 'review-1',
    personaId: 'style-reviewer',
    targetPath: '正文.md',
    baselineHash: hash(text),
    text: normalizeDocumentText(candidate?.proposedContent ?? text),
    model: { provider: 'archive', modelId: 'stored-result' },
    status: 'done',
    runId: 'run-1',
    outputRef: '.chaptale/reviews/run-1.json',
    memoryRefs: [],
    excludedSources: [],
    createdAt: now,
    updatedAt: now,
    ...(candidate ? { candidateId: candidate.id, candidateRevision: candidate.revision } : {})
  };
  await reviews.create(root, job);
  await writeFile(
    path.join(root, job.outputRef!),
    JSON.stringify({
      summary: '节奏问题',
      issues: [
        {
          agentType: 'style',
          type: 'flat_rhythm',
          severity: 'low',
          quote: '林晚慢慢走进门。',
          reason: '拖沓',
          suggestion: '精简动词'
        }
      ]
    })
  );
}
async function prepare(indexes = [0]) {
  return prepareRewriteInput(
    { rootPath: root, reviewId: 'review-1', issueIndexes: indexes },
    {
      readReview: (cwd, id) => reviews.read(cwd, id),
      workspace,
      candidates
    }
  );
}
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-rewrite-'));
  reviews = new ReviewWorkflowStore();
  workspace = new WorkspaceService({
    getStorageContext: async () => ({ storageMode: 'workspace', workspacePath: root })
  });
  candidates = new CandidateStore(workspace);
  await writeFile(path.join(root, '正文.md'), text);
});
afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-rewrite-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});
describe('修订输入与派生候选', () => {
  it('从真实输出读取选中问题，不修改源文件', async () => {
    await review();
    const { plan } = await prepare([0, 0]);
    expect(plan.issues).toHaveLength(1);
    expect(plan.spans[0]?.text).toBe('林晚慢慢走进门。');
    expect(plan.sourceHash).toBe(hash(text));
    expect(await readFile(path.join(root, '正文.md'), 'utf8')).toBe(text);
  });
  it.each(['resolved', 'ignored'] as const)('不再向模型发送 %s 问题', async status => {
    await review();
    await reviews.resolve(root, 'review-1', [0], status);
    await expect(prepare()).rejects.toThrow('已处理');
  });
  it('越界问题、正文变化与原输出变化必须重新确认', async () => {
    await review();
    await expect(prepare([3])).rejects.toThrow('不存在');
    await writeFile(path.join(root, '正文.md'), text + '变化');
    await expect(prepare()).rejects.toThrow('基线已变化');
  });
  it('派生修订相对正文 diff，保留原候选，接受不改其他行', async () => {
    const now = new Date().toISOString();
    const parent: Candidate = {
      id: 'parent',
      revision: 1,
      status: 'ready',
      targetPath: '正文.md',
      baselineHash: hash(text),
      baselineContent: text,
      proposedContent: text.replace('前言', '开场'),
      range: { from: 0, to: normalizeDocumentText(text).length },
      goal: '原候选',
      packId: 'pack-1',
      personaId: 'draft',
      model: { provider: 'archive', modelId: 'stored-result' },
      usedStalePack: false,
      createdAt: now,
      updatedAt: now,
      acceptances: []
    };
    await candidates.create(root, parent);
    await review(parent);
    const { plan, baselineContent, sourceContent } = await prepare();
    expect(plan.parentId).toBe(parent.id);
    const child = { ...parent, id: 'child', status: 'generating' as const, baselineContent, parentId: parent.id };
    await candidates.create(root, child);
    const revised = applyRewriteEdits(
      sourceContent,
      [
        {
          original: '林晚慢慢走进门。',
          replacement: '林晚踱进门。',
          rationale: '精简动词'
        }
      ],
      plan.spans
    );
    const ready = await candidates.finishRevision(
      root,
      child.id,
      revised,
      'rewrite-run',
      '.chaptale/runs/outputs/rewrite-run.json'
    );
    expect((await candidates.read(root, parent.id)).candidate.proposedContent).toBe(parent.proposedContent);
    await candidates.apply({
      rootPath: root,
      candidateId: child.id,
      revision: ready.candidate.revision,
      changeIndexes: ready.changes.map((_, index) => index)
    });
    expect(await readFile(path.join(root, '正文.md'), 'utf8')).toBe(
      text.replace('前言', '开场').replace('慢慢走', '踱')
    );
  });
});
