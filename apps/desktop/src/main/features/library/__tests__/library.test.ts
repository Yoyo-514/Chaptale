import { mkdir, mkdtemp, readFile, readdir, rename, rm, stat, symlink, utimes, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssetCatalog } from '../../search/index/asset-catalog';
import { WorkspaceService } from '../../workspace/service';
import { LibraryService, renderReferenceSources } from '../service';

let home: string;
let root: string;
let currentRoot: string;
let catalog: AssetCatalog;
let service: LibraryService;

async function put(relativePath: string, content: string) {
  const target = path.join(root, relativePath);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, content);
}

beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-library-'));
  root = path.join(home, 'book');
  currentRoot = root;
  await mkdir(root);
  catalog = new AssetCatalog(path.join(home, 'cache'));
  const workspace = new WorkspaceService({
    getStorageContext: async () => ({ storageMode: 'workspace', workspacePath: currentRoot })
  });
  service = new LibraryService(workspace, {
    listAssets: cwd => catalog.list(cwd),
    resolveLink: (cwd, link) => catalog.resolveLink(cwd, link)
  });
});
afterEach(async () => {
  expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home).startsWith('chaptale-library-')).toBe(true);
  await rm(home, { recursive: true, force: true });
});

describe('资产目录', () => {
  it('按自定义角色发现普通文档，保留坏元数据，排除冲突与生成目录', async () => {
    await put(
      'chaptale.json',
      JSON.stringify({ version: 1, id: 'book', title: '书', kind: 'novel', dirs: { characters: '人物' } })
    );
    await put('人物/甲.md', '---\nid: a\nkind: character\ntitle: 甲\n---\n[[乙]]');
    await put('设定/乙.md', '---\ntitle: 乙\n---\n风雪');
    await put('坏.md', '---\ntitle: [\n---\n完整原文');
    await put('未分类.md', '普通内容');
    await put('人物/甲 (conflicted copy).md', '副本');
    await put('node_modules/不要读.md', '模块');
    await put('.chaptale/packs/旧.md', '旧包');
    await put('.chaptale/memory/notes/观察.md', '观察');
    const snapshot = await service.listAssets(root);
    expect(snapshot.assets.map(asset => asset.sourcePath)).toEqual(
      expect.arrayContaining(['人物/甲.md', '设定/乙.md', '坏.md', '未分类.md', '.chaptale/memory/notes/观察.md'])
    );
    expect(snapshot.assets).toHaveLength(5);
    expect(snapshot.assets.find(asset => asset.sourcePath === '人物/甲.md')).toMatchObject({
      role: 'characters',
      id: 'a',
      links: [{ link: '[[乙]]', status: 'resolved', targetPath: '设定/乙.md' }]
    });
    expect(snapshot.assets.find(asset => asset.sourcePath === '设定/乙.md')?.backlinks).toEqual(['人物/甲.md']);
    expect(snapshot.assets.find(asset => asset.sourcePath === '坏.md')).toMatchObject({
      diagnostic: expect.any(String),
      excerpt: expect.stringContaining('完整原文')
    });
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({ code: 'conflict-copy-skipped' }));
  });

  it('同名不猜测，路径和别名解析明确，唯一 id 支持移动且缓存重载仍可解析', async () => {
    await put('角色/甲.md', '---\nid: a\ntitle: 同名\naliases: [阿甲]\n---\n甲');
    await put('设定/乙.md', '---\nid: b\ntitle: 同名\n---\n乙');
    expect(await catalog.resolveLink(root, '[[同名]]')).toMatchObject({
      status: 'ambiguous',
      candidates: ['角色/甲.md', '设定/乙.md'].toSorted()
    });
    expect(await catalog.resolveLink(root, '[[阿甲]]')).toMatchObject({ status: 'resolved', targetPath: '角色/甲.md' });
    await rename(path.join(root, '角色/甲.md'), path.join(root, '角色/新甲.md'));
    expect(await catalog.resolveLink(root, '[[角色/甲]]')).toMatchObject({
      status: 'moved',
      targetPath: '角色/新甲.md'
    });
    const reloaded = new AssetCatalog(path.join(home, 'cache'));
    expect(await reloaded.resolveLink(root, '[[角色/甲]]')).toMatchObject({
      status: 'moved',
      targetPath: '角色/新甲.md'
    });
    await put('角色/副本.md', '---\nid: a\n---\n重复 id');
    expect(await catalog.resolveLink(root, '[[角色/甲]]')).toMatchObject({ status: 'ambiguous' });
    expect((await catalog.list(root)).diagnostics).toContainEqual(expect.objectContaining({ code: 'duplicate-id' }));
  });

  it('watch 失效会重新核 hash，即使 size 与 mtime 没变', async () => {
    await put('甲.md', '版本甲');
    const before = (await catalog.list(root)).assets[0]!;
    const timestamp = await stat(path.join(root, '甲.md'));
    await put('甲.md', '版本乙');
    await utimes(path.join(root, '甲.md'), timestamp.atime, timestamp.mtime);
    catalog.invalidate(root, ['甲.md']);
    const after = (await catalog.list(root)).assets[0]!;
    expect(after.contentHash).not.toBe(before.contentHash);
    expect(after.excerpt).toBe('版本乙');
    await rename(path.join(root, '甲.md'), path.join(root, '乙.md'));
    expect((await catalog.list(root)).assets.map(asset => asset.sourcePath)).toEqual(['乙.md']);
  });
});

describe('参考快照', () => {
  const args = () => ({
    rootPath: root,
    goal: '写入风雪',
    budgetChars: 100,
    selections: [{ sourcePath: '角色/甲.md', pinned: true, mode: 'full' as const, reason: '作者选择' }]
  });

  it('冻结只增、内容与 hash 可追溯，相同资料生成相同模型前缀', async () => {
    const original = '\uFEFF---\r\nid: a\r\ntitle: 甲\r\n---\r\n原文 & <instruction>\r\n';
    await put('角色/甲.md', original);
    const first = await service.freezePack(args());
    const second = await service.freezePack(args());
    expect(first.id).not.toBe(second.id);
    expect(first.prompt).toBe(second.prompt);
    expect(first.prompt).toContain('&amp; &lt;instruction&gt;');
    expect(first.prompt).not.toContain(first.id);
    const changedGoal = await service.composePack({ ...args(), goal: '改变场景目标' });
    expect(changedGoal.prompt).not.toBe(first.prompt);
    expect(renderReferenceSources(changedGoal.sections)).toBe(renderReferenceSources(first.sections));
    expect(first.sections[0]?.content).toBe(original);
    expect(await service.readPack(root, first.id)).toMatchObject(first);
    expect(await readdir(path.join(root, '.chaptale/packs'))).toHaveLength(2);
    expect(await service.checkPack(root, first.id)).toMatchObject({ stale: false });
    await put('角色/甲.md', '已更新');
    expect(await service.checkPack(root, first.id)).toMatchObject({ stale: true, sources: [{ state: 'changed' }] });
    expect((await service.readPack(root, first.id)).sections[0]?.content).toBe(original);
  });

  it('选段支持 CRLF，失效选段与空快照失败而不截断来源', async () => {
    await put('角色/甲.md', '开头\r\n第二行\r\n末尾');
    const quoted = args();
    const selected = await service.composePack({
      ...quoted,
      selections: [{ ...quoted.selections[0]!, quote: '开头\n第二行' }]
    });
    expect(selected.sections[0]?.content).toBe('开头\n第二行');
    await expect(
      service.composePack({ ...quoted, selections: [{ ...quoted.selections[0]!, quote: '不在文中' }] })
    ).rejects.toThrow('选段已变化');
    await expect(service.freezePack({ ...quoted, goal: '', selections: [] })).rejects.toThrow(
      '请填写写作目标或选择参考内容'
    );
    expect(await readFile(path.join(root, '角色/甲.md'), 'utf8')).toBe('开头\r\n第二行\r\n末尾');
  });

  it('总量上限在冻结前拒绝，原文不截断也不留下半个快照', async () => {
    const content = 'x'.repeat(4 * 1024 * 1024 + 1);
    await put('角色/甲.md', content);
    await put('角色/乙.md', content);
    await expect(
      service.freezePack({
        ...args(),
        selections: [...args().selections, { sourcePath: '角色/乙.md', pinned: true, mode: 'full' }]
      })
    ).rejects.toThrow('参考总量超过 8 MiB');
    expect((await stat(path.join(root, '角色/甲.md'))).size).toBe(content.length);
    await expect(stat(path.join(root, '.chaptale/packs'))).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('快照正文被修改时拒绝使用，工作区身份与链接目录不允许绕过', async () => {
    await put('角色/甲.md', '原文');
    const pack = await service.freezePack(args());
    const packFile = path.join(root, `.chaptale/packs/${pack.id}.md`);
    await writeFile(packFile, (await readFile(packFile, 'utf8')).replace('原文', '改动'));
    await expect(service.readPack(root, pack.id)).rejects.toThrow('正文已被修改');
    currentRoot = home;
    await expect(service.listAssets(root)).rejects.toThrow('工作区已经切换');
    currentRoot = root;
    await expect(service.readPack(root, '../other')).rejects.toThrow('id 不合法');
    const linkedRoot = path.join(home, 'linked');
    await mkdir(path.join(linkedRoot, '.chaptale'), { recursive: true });
    await symlink(path.join(root, '.chaptale/packs'), path.join(linkedRoot, '.chaptale/packs'), 'junction');
    currentRoot = linkedRoot;
    await expect(
      service.freezePack({ rootPath: linkedRoot, goal: '目标', budgetChars: 9000, selections: [] })
    ).rejects.toThrow();
    expect(await readdir(path.join(root, '.chaptale/packs'))).toHaveLength(1);
  });
});
