import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ReviewOutputStore } from '../../features/reviews/store';
import { AgentRunStore } from '../../features/runs/store';
import { TaskOutputRouter } from '../task-output-router';

describe('TaskOutputRouter', () => {
  let cwd: string;
  let runStore: AgentRunStore;
  let reviewStore: ReviewOutputStore;
  let router: TaskOutputRouter;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-task-output-router-'));
    runStore = new AgentRunStore({ resolveCwd: () => cwd });
    reviewStore = new ReviewOutputStore({ resolveCwd: () => cwd });
    router = new TaskOutputRouter({ runStore, reviewStore });
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('routes successful review output to reviews without raw wrapper', async () => {
    const output = { issues: [], summary: '无问题' };

    const outputRef = await router.saveSuccess({
      runId: 'review-run',
      isReview: true,
      output,
      rawText: '<output>{}</output>',
      cwd
    });

    expect(outputRef).toBe('.chaptale/reviews/review-run.json');
    expect(JSON.parse(await fs.readFile(path.join(cwd, outputRef), 'utf8'))).toEqual(output);
    await expect(
      fs.readFile(path.join(cwd, '.chaptale', 'runs', 'outputs', 'review-run.json'), 'utf8')
    ).rejects.toThrow();
    await expect(router.read(outputRef)).resolves.toEqual({ kind: 'review', runId: 'review-run', output });
  });

  it('routes successful non-review and failed output to raw run outputs', async () => {
    const successRef = await router.saveSuccess({
      runId: 'raw-success',
      isReview: false,
      output: {
        objective: '继续写',
        authorConstraints: [],
        confirmedFacts: [],
        creativeState: [],
        decisions: [],
        unresolved: [],
        recentProgress: [],
        nextIntent: []
      },
      rawText: 'raw success text',
      cwd
    });
    const failedRef = await router.saveFailure({ runId: 'raw-failed', rawText: 'bad output', cwd });

    expect(successRef).toBe('.chaptale/runs/outputs/raw-success.json');
    expect(failedRef).toBe('.chaptale/runs/outputs/raw-failed.json');
    await expect(router.read(successRef)).resolves.toEqual({
      kind: 'raw',
      runId: 'raw-success',
      rawText: 'raw success text'
    });
    await expect(router.read(failedRef)).resolves.toEqual({ kind: 'raw', runId: 'raw-failed', rawText: 'bad output' });
  });

  it('delegates reads through store safety checks and removes only matching output refs', async () => {
    const reviewRef = await router.saveSuccess({
      runId: 'review-run',
      isReview: true,
      output: { issues: [], summary: '无问题' },
      rawText: 'raw',
      cwd
    });
    const rawRef = await router.saveFailure({ runId: 'raw-run', rawText: 'raw', cwd });

    await expect(router.read('.chaptale/reviews/review-run.state.json')).resolves.toBeNull();
    await expect(router.read('../secret.json')).resolves.toBeNull();

    await router.remove(reviewRef, cwd);
    await router.remove(rawRef, cwd);

    await expect(fs.readFile(path.join(cwd, reviewRef), 'utf8')).rejects.toThrow();
    await expect(fs.readFile(path.join(cwd, rawRef), 'utf8')).rejects.toThrow();
  });

  it('accepts only exact POSIX output refs returned by stores', async () => {
    const reviewRef = await router.saveSuccess({
      runId: 'review-run',
      isReview: true,
      output: { issues: [], summary: '无问题' },
      rawText: 'raw',
      cwd
    });
    const rawRef = await router.saveFailure({ runId: 'raw-run', rawText: 'raw', cwd });

    await expect(router.read(reviewRef.replaceAll('/', '\\'))).resolves.toBeNull();
    await expect(router.read(rawRef.replaceAll('/', '\\'))).resolves.toBeNull();
    await expect(router.read('.CHAPTALE/reviews/review-run.json')).resolves.toBeNull();
    await expect(router.read('.chaptale/REVIEWS/review-run.json')).resolves.toBeNull();
    await expect(router.read('.chaptale/reviews/nested/review-run.json')).resolves.toBeNull();
    await expect(router.read('.chaptale/runs/outputs/nested/raw-run.json')).resolves.toBeNull();

    await router.remove(reviewRef.replaceAll('/', '\\'), cwd);
    await router.remove(rawRef.replaceAll('/', '\\'), cwd);
    await router.remove('.CHAPTALE/reviews/review-run.json', cwd);
    await router.remove('.chaptale/runs/outputs/nested/raw-run.json', cwd);

    await expect(fs.readFile(path.join(cwd, reviewRef), 'utf8')).resolves.toContain('无问题');
    await expect(fs.readFile(path.join(cwd, rawRef), 'utf8')).resolves.toContain('raw');
  });
});
