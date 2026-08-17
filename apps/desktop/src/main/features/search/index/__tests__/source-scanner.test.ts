import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { parseFrontmatter } from '../../../../core/frontmatter/parse';
import type { IndexSourceRoot } from '../../types';
import { discoverIndexSourceFiles, readIndexSourceDocuments, scanIndexSources } from '../source-scanner';

describe('scanIndexSources', () => {
  let cwd: string;
  let root: IndexSourceRoot;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-index-scan-'));
    root = { domain: 'canon', role: 'characters', absolutePath: path.join(cwd, '角色') };
    await fs.mkdir(path.join(root.absolutePath, '主要'), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('递归读取 Markdown 并提取可检索元数据', async () => {
    await fs.writeFile(
      path.join(root.absolutePath, '主要', '林晚.md'),
      '---\ntitle: 林晚\nkind: character\naliases:\n  - 小晚\n---\n机械师。',
      'utf8'
    );
    await fs.writeFile(path.join(root.absolutePath, 'ignore.txt'), 'not markdown', 'utf8');

    const result = await scanIndexSources({ cwd, roots: [root], parseFrontmatter });

    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      sourcePath: '角色/主要/林晚.md',
      title: '林晚',
      kind: 'character',
      aliases: ['小晚'],
      body: '机械师。',
      domain: 'canon',
      role: 'characters'
    });
    expect(result.fingerprint).toHaveLength(64);
  });

  it.each(['林晚 (冲突).md', '林晚 conflicted copy.md', '林晚.sync-conflict.md', '林晚冲突副本.md'])(
    '跳过明确的冲突副本 %s',
    async fileName => {
      await fs.writeFile(path.join(root.absolutePath, fileName), '# duplicate', 'utf8');

      const result = await scanIndexSources({ cwd, roots: [root], parseFrontmatter });

      expect(result.documents).toEqual([]);
      expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'conflict-copy-skipped' }));
    }
  );

  it('跳过 archived 文档并保留普通文件', async () => {
    await fs.writeFile(path.join(root.absolutePath, '旧设定.md'), '---\nstatus: archived\n---\n旧内容', 'utf8');
    await fs.writeFile(path.join(root.absolutePath, '设备名-后缀.md'), '正常内容', 'utf8');

    const result = await scanIndexSources({ cwd, roots: [root], parseFrontmatter });

    expect(result.documents.map(document => document.title)).toEqual(['设备名-后缀']);
  });

  it('discovery 只读取目录元数据，正文解析在第二阶段执行', async () => {
    await fs.writeFile(path.join(root.absolutePath, '林晚.md'), '# 林晚', 'utf8');
    const readFile = vi.fn((filePath: string) => fs.readFile(filePath, 'utf8'));

    const discovered = await discoverIndexSourceFiles({ cwd, roots: [root] });
    expect(readFile).not.toHaveBeenCalled();

    const read = await readIndexSourceDocuments({
      files: discovered.files,
      parseFrontmatter,
      readFile
    });
    expect(readFile).toHaveBeenCalledTimes(1);
    expect(read.documents[0].title).toBe('林晚');
  });

  it('拒绝指向 workspace 外部的根目录符号链接', async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-index-outside-'));
    try {
      await fs.writeFile(path.join(outside, '秘密.md'), '工作区外内容', 'utf8');
      await fs.rm(root.absolutePath, { recursive: true, force: true });
      await fs.symlink(outside, root.absolutePath, process.platform === 'win32' ? 'junction' : 'dir');

      const result = await discoverIndexSourceFiles({ cwd, roots: [root] });

      expect(result.files).toEqual([]);
      expect(result.diagnostics).toContainEqual(
        expect.objectContaining({ code: expect.stringMatching(/root-symlink-skipped|source-outside-workspace/) })
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it('单文件读取失败时继续扫描并报告诊断', async () => {
    await fs.writeFile(path.join(root.absolutePath, '坏文件.md'), 'bad', 'utf8');
    await fs.writeFile(path.join(root.absolutePath, '好文件.md'), 'good', 'utf8');
    const readFile = vi.fn(async (filePath: string) => {
      if (filePath.endsWith('坏文件.md')) throw new Error('denied');
      return fs.readFile(filePath, 'utf8');
    });

    const result = await scanIndexSources({ cwd, roots: [root], parseFrontmatter, readFile });

    expect(result.documents.map(document => document.title)).toEqual(['好文件']);
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'source-read-failed' }));
  });
});
