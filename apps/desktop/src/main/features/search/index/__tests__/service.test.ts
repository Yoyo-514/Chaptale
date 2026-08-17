import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFrontmatter } from '../../../../core/frontmatter/parse';
import { IntlSegmenterTermTokenizer } from '../../tokenize/term';
import type { IndexCacheEnvelope, IndexCachePort } from '../cache-store';
import { IndexService } from '../service';
import { WorkspaceIndexSourceResolver } from '../source-resolver';
import { readIndexSourceDocuments } from '../source-scanner';

function fallbackTokenizer() {
  return Promise.resolve({ tokenizer: new IntlSegmenterTermTokenizer(), diagnostics: [] });
}

describe('IndexService', () => {
  let rootDir: string;
  let cwd: string;
  let cacheRoot: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-index-service-'));
    cwd = path.join(rootDir, 'workspace');
    cacheRoot = path.join(rootDir, 'cache');
    await fs.mkdir(path.join(cwd, '角色'), { recursive: true });
    await fs.mkdir(path.join(cwd, '.chaptale', 'memory', 'notes'), { recursive: true });
    await fs.writeFile(
      path.join(cwd, '角色', '林晚.md'),
      '---\ntitle: 林晚\nkind: character\n---\n# 经历\n\n加入机械师公会。',
      'utf8'
    );
    await fs.writeFile(path.join(cwd, '.chaptale', 'memory', 'notes', '线索.md'), '# 线索\n\n灵脉共振。', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  function createService(overrides: Partial<ConstructorParameters<typeof IndexService>[0]> = {}) {
    return new IndexService({
      resolver: new WorkspaceIndexSourceResolver(),
      parseFrontmatter,
      cacheRoot,
      createTokenizer: fallbackTokenizer,
      ...overrides
    });
  }

  it('索引资产与 memory，并支持拼音、domain 和 getChunk', async () => {
    const service = createService();

    const character = await service.search(cwd, 'linwan');
    const notes = await service.search(cwd, '灵脉', { domains: ['notes'] });
    const notesByPinyin = await service.search(cwd, 'lingmaigongzhen', { domains: ['notes'] });
    const chunk = await service.getChunk(cwd, notes[0].chunkId);

    expect(character[0]).toMatchObject({ title: '林晚', domain: 'canon' });
    expect(notes).toHaveLength(1);
    expect(notesByPinyin).toHaveLength(1);
    expect(chunk?.body).toContain('灵脉共振');
  });

  it('cold build 读取正文，warm cache 只扫描元数据', async () => {
    const coldRead = vi.fn(readIndexSourceDocuments);
    await createService({ readDocuments: coldRead }).search(cwd, '林晚');
    expect(coldRead).toHaveBeenCalledTimes(1);

    const warmRead = vi.fn(readIndexSourceDocuments);
    const chunkDocument = vi.fn(() => {
      throw new Error('cache hit should not chunk');
    });
    const results = await createService({ readDocuments: warmRead, chunkDocument }).search(cwd, '林晚');

    expect(results[0].title).toBe('林晚');
    expect(warmRead).not.toHaveBeenCalled();
    expect(chunkDocument).not.toHaveBeenCalled();
  });

  it('查询只读已构建快照，refresh 后才纳入源文件变化', async () => {
    const service = createService();
    expect(service.status(cwd)).toEqual({ state: 'idle' });
    expect(await service.search(cwd, '逐光城')).toEqual([]);
    expect(service.status(cwd)).toMatchObject({ state: 'ready', chunkCount: 2 });
    await fs.writeFile(path.join(cwd, '角色', '林晚.md'), '# 新地点\n\n逐光城已经开放。', 'utf8');

    expect(await service.search(cwd, '逐光城')).toEqual([]);
    await service.refresh(cwd);
    expect((await service.search(cwd, '逐光城'))[0].body).toContain('逐光城');
  });

  it('invalidate 清除指定 workspace 快照', async () => {
    const service = createService();
    await service.ensureReady(cwd);

    await service.invalidate(cwd);

    expect(service.status(cwd)).toEqual({ state: 'idle' });
  });

  it('并发 ensure 对同一 workspace 只初始化一次 tokenizer', async () => {
    const createTokenizer = vi.fn(async () => {
      await new Promise(resolve => setTimeout(resolve, 10));
      return fallbackTokenizer();
    });
    const service = createService({ createTokenizer });

    await Promise.all([service.ensureReady(cwd), service.ensureReady(cwd), service.ensureReady(cwd)]);

    expect(createTokenizer).toHaveBeenCalledTimes(1);
  });

  it('cache 写失败时保留内存检索并返回诊断', async () => {
    const cacheStore: IndexCachePort = {
      read: vi.fn(async () => undefined),
      write: vi.fn(async (_cwd: string, _value: IndexCacheEnvelope) => {
        throw new Error('disk full');
      })
    };
    const service = createService({ cacheStore });

    const ready = await service.ensureReady(cwd);
    const results = await service.search(cwd, '林晚');

    expect(results[0].title).toBe('林晚');
    expect(ready.diagnostics).toContainEqual(expect.objectContaining({ code: 'cache-write-failed' }));
  });
});
