import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { IndexCacheStore, type IndexCacheEnvelope } from '../cache-store';

function envelope(): IndexCacheEnvelope {
  return {
    schemaVersion: 1,
    workspaceKey: 'workspace-key',
    sourceFingerprint: 'source',
    dictionaryFingerprint: 'dictionary',
    tokenizerId: 'intl-bigram-v1',
    customTerms: ['林晚'],
    chunkConfig: { maxTokens: 1000, overlapTokens: 200 },
    generatedAt: '2026-01-01T00:00:00.000Z',
    chunks: [],
    miniSearch: { documentCount: 0 }
  };
}

describe('IndexCacheStore', () => {
  let rootDir: string;
  let cwd: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-index-cache-'));
    cwd = path.join(rootDir, 'workspace');
    await fs.mkdir(cwd);
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('原子写入并读取合法 envelope', async () => {
    const store = new IndexCacheStore(rootDir);
    await store.write(cwd, envelope());

    expect(await store.read(cwd)).toEqual(envelope());
  });

  it('损坏或版本不匹配时视为 cache miss', async () => {
    const store = new IndexCacheStore(rootDir);
    await fs.mkdir(path.dirname(store.resolvePath(cwd)), { recursive: true });
    await fs.writeFile(store.resolvePath(cwd), '{broken', 'utf8');
    expect(await store.read(cwd)).toBeUndefined();

    await fs.writeFile(store.resolvePath(cwd), JSON.stringify({ ...envelope(), schemaVersion: 2 }), 'utf8');
    expect(await store.read(cwd)).toBeUndefined();
  });
});
