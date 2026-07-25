import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceIndexSourceResolver } from '../source-resolver';

describe('WorkspaceIndexSourceResolver', () => {
  let cwd: string;

  beforeEach(async () => {
    cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-index-roots-'));
  });

  afterEach(async () => {
    await fs.rm(cwd, { recursive: true, force: true });
  });

  it('没有配置时解析四类资产与两个 memory 根目录', async () => {
    const result = await new WorkspaceIndexSourceResolver().resolve(cwd);

    expect(result.roots.map(root => [root.role, path.relative(cwd, root.absolutePath)])).toEqual([
      ['outline', '大纲'],
      ['world', '设定'],
      ['characters', '角色'],
      ['threads', '伏笔'],
      ['notes', path.join('.chaptale', 'memory', 'notes')],
      ['summaries', path.join('.chaptale', 'memory', 'summaries')]
    ]);
    expect(result.diagnostics).toEqual([]);
  });

  it('使用 chaptale.json 的自定义资产目录', async () => {
    await fs.writeFile(
      path.join(cwd, 'chaptale.json'),
      JSON.stringify({ dirs: { outline: 'plot', world: 'lore', characters: 'cast', threads: 'seeds' } }),
      'utf8'
    );

    const result = await new WorkspaceIndexSourceResolver().resolve(cwd);

    expect(result.roots.slice(0, 4).map(root => path.basename(root.absolutePath))).toEqual([
      'plot',
      'lore',
      'cast',
      'seeds'
    ]);
  });

  it('配置损坏时诊断并回退默认目录', async () => {
    await fs.writeFile(path.join(cwd, 'chaptale.json'), '{broken', 'utf8');

    const result = await new WorkspaceIndexSourceResolver().resolve(cwd);

    expect(path.basename(result.roots[0].absolutePath)).toBe('大纲');
    expect(result.diagnostics).toContainEqual(expect.objectContaining({ code: 'config-invalid' }));
  });

  it('拒绝越过 workspace 的目录映射并仅回退该目录', async () => {
    await fs.writeFile(
      path.join(cwd, 'chaptale.json'),
      JSON.stringify({ dirs: { outline: '../escape', world: 'custom-world' } }),
      'utf8'
    );

    const result = await new WorkspaceIndexSourceResolver().resolve(cwd);

    expect(path.basename(result.roots[0].absolutePath)).toBe('大纲');
    expect(path.basename(result.roots[1].absolutePath)).toBe('custom-world');
    expect(result.diagnostics).toContainEqual(
      expect.objectContaining({ code: 'source-outside-workspace', role: 'outline' })
    );
  });
});
