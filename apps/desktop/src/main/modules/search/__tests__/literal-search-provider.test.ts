import { parseFrontmatter } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { LiteralSearchProvider } from '../literal-search-provider';
import { WorkspaceIndexSourceResolver } from '../source-resolver';

describe('LiteralSearchProvider', () => {
  let rootDir: string;
  let cwd: string;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-literal-search-'));
    cwd = path.join(rootDir, 'workspace');
    await fs.mkdir(path.join(cwd, '角色'), { recursive: true });
    await fs.mkdir(path.join(cwd, '.chaptale', 'memory', 'notes'), { recursive: true });
    await fs.writeFile(path.join(cwd, '角色', '林晚.md'), '# 经历\n\n加入机械师公会。', 'utf8');
    await fs.writeFile(path.join(cwd, '.chaptale', 'memory', 'notes', '观察.md'), '# 观察\n\n机械师徽章。', 'utf8');
    await fs.writeFile(
      path.join(cwd, '角色', '旧档案.md'),
      '---\nstatus: archived\n---\n# 旧档案\n\n机械师旧记录。',
      'utf8'
    );
    await fs.writeFile(path.join(cwd, '角色', '人物 (冲突).md'), '# 冲突\n\n机械师冲突副本。', 'utf8');
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
  });

  it('scans allowed Markdown sources without using the keyword index', async () => {
    const provider = new LiteralSearchProvider({
      resolver: new WorkspaceIndexSourceResolver(),
      parseFrontmatter
    });

    const result = await provider.search({
      cwd,
      query: '机械师',
      domains: ['canon'],
      limit: 10
    });

    expect(result.results).toHaveLength(1);
    expect(result.results[0]).toMatchObject({
      sourcePath: '角色/林晚.md',
      domain: 'canon',
      headingPath: ['经历']
    });
    expect(result.results[0].chunkId).toBeTruthy();
    expect(result.results[0].body).toContain('机械师公会');
    expect(result.results.every(item => !path.isAbsolute(item.sourcePath))).toBe(true);
  });

  it('honors domain filters and reports unreadable files without failing the scan', async () => {
    const unreadable = path.join(cwd, '.chaptale', 'memory', 'notes', '坏文件.md');
    await fs.writeFile(unreadable, '机械师', 'utf8');
    const provider = new LiteralSearchProvider({
      resolver: new WorkspaceIndexSourceResolver(),
      parseFrontmatter,
      readFile: async filePath => {
        if (filePath === unreadable) throw new Error('denied');
        return fs.readFile(filePath, 'utf8');
      }
    });

    const result = await provider.search({
      cwd,
      query: '机械师',
      domains: ['notes'],
      limit: 10
    });

    expect(result.results.map(item => item.sourcePath)).toEqual(['.chaptale/memory/notes/观察.md']);
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'source-read-failed', sourcePath: '.chaptale/memory/notes/坏文件.md' })
    );
  });
});
