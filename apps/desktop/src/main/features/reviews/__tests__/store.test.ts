import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ReviewOutputStore } from '../store';

function isSymlinkPrivilegeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    ['EPERM', 'EACCES', 'EINVAL'].includes(String((error as { code: unknown }).code))
  );
}

async function createSymlinkOrSkip(target: string, linkPath: string, type: 'dir' | 'file'): Promise<boolean> {
  try {
    await fs.symlink(target, linkPath, type);
    return true;
  } catch (error) {
    if (isSymlinkPrivilegeError(error)) {
      return false;
    }

    throw error;
  }
}

describe('ReviewOutputStore', () => {
  let cwd: string;
  let store: ReviewOutputStore;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-reviews-'));
    store = new ReviewOutputStore({ resolveCwd: () => cwd });
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('saves validated review output atomically and reads it back by portable ref', async () => {
    const output = { issues: [], summary: '无问题' };

    const ref = await store.save('run-1', output, cwd);

    expect(ref).toBe('.chaptale/reviews/run-1.json');
    expect(JSON.parse(await fs.readFile(path.join(cwd, ref), 'utf8'))).toEqual(output);
    expect(await store.read(ref)).toEqual({ kind: 'review', runId: 'run-1', output });

    const files = await fs.readdir(path.join(cwd, '.chaptale', 'reviews'));
    expect(files.filter(file => file.endsWith('.tmp'))).toEqual([]);
  });

  it('rejects unsafe, non-direct or malformed review output refs', async () => {
    await store.save('run-1', { issues: [], summary: '无问题' }, cwd);

    await expect(store.read('../secret.json')).resolves.toBeNull();
    await expect(store.read('.chaptale/reviews/run-1.state.json')).resolves.toBeNull();
    await expect(store.read('.chaptale/reviews/nested/run-1.json')).resolves.toBeNull();
    await expect(store.read('.chaptale/reviews/../../../package.json')).resolves.toBeNull();
    await expect(store.read('.chaptale/runs/outputs/run-1.json')).resolves.toBeNull();

    const badJsonPath = path.join(cwd, '.chaptale', 'reviews', 'bad.json');
    await fs.writeFile(badJsonPath, '不是 JSON', 'utf8');

    await expect(store.read('.chaptale/reviews/bad.json')).resolves.toBeNull();
  });

  it('rejects unsafe runId values before building review file paths', async () => {
    const unsafeRunIds = ['', '.', '..', 'run.state', 'nested/run', 'nested\\run', 'C:\\tmp\\run', '/tmp/run', 'run:1'];

    for (const runId of unsafeRunIds) {
      await expect(store.save(runId, { issues: [], summary: '无问题' }, cwd)).rejects.toThrow(/runId/);
    }
  });

  it('does not follow a symlinked reviews directory for save, read or remove', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-reviews-outside-'));
    const reviewsDir = path.join(cwd, '.chaptale', 'reviews');
    await fs.mkdir(path.dirname(reviewsDir), { recursive: true });

    if (!(await createSymlinkOrSkip(outsideDir, reviewsDir, 'dir'))) {
      await fs.rm(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      const outsideFile = path.join(outsideDir, 'run-1.json');
      await fs.writeFile(outsideFile, JSON.stringify({ leaked: true }), 'utf8');

      await expect(store.save('run-1', { issues: [], summary: '无问题' }, cwd)).rejects.toThrow();
      await expect(store.read('.chaptale/reviews/run-1.json')).resolves.toBeNull();
      await store.remove('.chaptale/reviews/run-1.json', cwd);
      await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe(JSON.stringify({ leaked: true }));
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('does not read, remove or overwrite a symlinked review output file', async () => {
    const outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-review-file-outside-'));
    const outsideFile = path.join(outsideDir, 'run-1.json');
    const reviewsDir = path.join(cwd, '.chaptale', 'reviews');
    const linkedFile = path.join(reviewsDir, 'run-1.json');
    await fs.mkdir(reviewsDir, { recursive: true });
    await fs.writeFile(outsideFile, JSON.stringify({ leaked: true }), 'utf8');

    if (!(await createSymlinkOrSkip(outsideFile, linkedFile, 'file'))) {
      await fs.rm(outsideDir, { recursive: true, force: true });
      return;
    }

    try {
      await expect(store.read('.chaptale/reviews/run-1.json')).resolves.toBeNull();
      await store.remove('.chaptale/reviews/run-1.json', cwd);
      await expect(fs.readFile(outsideFile, 'utf8')).resolves.toBe(JSON.stringify({ leaked: true }));
      await expect(store.save('run-1', { issues: [], summary: '无问题' }, cwd)).rejects.toThrow();
    } finally {
      await fs.rm(outsideDir, { recursive: true, force: true });
    }
  });

  it('uses collision-resistant temporary files for concurrent saves of the same runId', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(123);

    await Promise.all(Array.from({ length: 8 }, (_, index) => store.save('same-run', { version: index }, cwd)));

    const saved = JSON.parse(await fs.readFile(path.join(cwd, '.chaptale', 'reviews', 'same-run.json'), 'utf8')) as {
      version: number;
    };
    expect(saved.version).toBeGreaterThanOrEqual(0);
    expect(saved.version).toBeLessThan(8);
    const files = await fs.readdir(path.join(cwd, '.chaptale', 'reviews'));
    expect(files.filter(file => file.endsWith('.tmp'))).toEqual([]);
  });
});
