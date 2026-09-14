import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createSyncService } from './harness';

let dir: string;
let workspace: string;
let cacheRoot: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-removal-'));
  workspace = path.join(dir, '长夜');
  cacheRoot = path.join(dir, 'cache');

  await mkdir(workspace, { recursive: true });
  await writeFile(
    path.join(workspace, 'chaptale.json'),
    `${JSON.stringify({ version: 1, id: '11111111-2222-3333-4444-555555555555', title: '长夜', kind: 'novel' }, null, 2)}\n`
  );
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('从云端批量删除归档', () => {
  it('一次删多份：逐条回结论，每份都真的从远端消失', async () => {
    const remote = await createSyncService({ dir, workspace, cacheRoot });

    remote.put('长夜 pc 20260913-210405.zip', new Uint8Array([1]));
    remote.put('长夜 pc 20260914-210405.zip', new Uint8Array([2]));
    remote.put('长夜 pc 20260915-210405.zip', new Uint8Array([3]));

    const result = await remote.instance.removeBackups({
      archiveIds: ['长夜 pc 20260913-210405.zip', '长夜 pc 20260915-210405.zip']
    });

    expect(result).toEqual({
      ok: true,
      removed: ['长夜 pc 20260913-210405.zip', '长夜 pc 20260915-210405.zip'],
      failed: []
    });

    const listing = await remote.instance.listBackups();

    expect(listing.ok && listing.archives.map(archive => archive.name)).toEqual(['长夜 pc 20260914-210405.zip']);
  });

  it('一份没删掉不拖累其余：删掉的算删掉，没删掉的带着原因回来', async () => {
    const remote = await createSyncService({ dir, workspace, cacheRoot });

    remote.put('a.zip', new Uint8Array([1]));
    remote.put('b.zip', new Uint8Array([2]));
    remote.put('c.zip', new Uint8Array([3]));
    remote.failRemove('b.zip', '网络断了');

    const result = await remote.instance.removeBackups({ archiveIds: ['a.zip', 'b.zip', 'c.zip'] });

    expect(result).toEqual({
      ok: true,
      removed: ['a.zip', 'c.zip'],
      failed: [{ archiveId: 'b.zip', message: '网络断了' }]
    });

    const listing = await remote.instance.listBackups();

    expect(listing.ok && listing.archives.map(archive => archive.name).toSorted()).toEqual(['b.zip']);
  });

  it('没绑定就不动远端：这类前提失败整批回一个原因', async () => {
    const remote = await createSyncService({ dir, workspace, cacheRoot, bound: false });

    remote.put('a.zip', new Uint8Array([1]));

    const result = await remote.instance.removeBackups({ archiveIds: ['a.zip'] });

    expect(result.ok).toBe(false);
    expect(result.ok ? '' : result.code).toBe('no-binding');
  });
});
