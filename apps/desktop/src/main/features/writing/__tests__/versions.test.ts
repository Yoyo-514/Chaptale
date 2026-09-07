import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AssetCatalog } from '../../search/index/asset-catalog';
import { readDocumentSnapshot } from '../../workspace/read-document';
import { WorkspaceService } from '../../workspace/service';
import { VersionStore } from '../versions';

let home: string, root: string, versions: VersionStore;
const document = (relativePath = '正文/一.md') =>
  readDocumentSnapshot({ rootPath: root, relativePath, maxBytes: 1024 * 1024 });
beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-versions-'));
  root = path.join(home, 'book');
  await mkdir(path.join(root, '正文'), { recursive: true });
  const catalog = new AssetCatalog(path.join(home, 'cache'));
  versions = new VersionStore(async cwd => (await catalog.list(cwd)).assets);
  await writeFile(path.join(root, '正文/一.md'), '---\nid: chapter-one\nkind: chapter\nstatus: draft\n---\n初稿。\n');
});
afterEach(async () => {
  expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home).startsWith('chaptale-versions-')).toBe(true);
  await rm(home, { recursive: true, force: true });
});
describe('不可变版本', () => {
  it('表单和源文件保存为 final 时先留存完整定稿，普通后续编辑不重复快照', async () => {
    const workspace = new WorkspaceService(
      { getStorageContext: async () => ({ storageMode: 'workspace' as const, workspacePath: root }) },
      {},
      undefined,
      undefined,
      (next, previous) => versions.preserveFinalization(next, previous)
    );
    const before = await document();
    const content = before.content.replace('status: draft', 'status: final') + '同时修改的正文。\n';
    const result = await workspace.writeDocument({
      rootPath: root,
      relativePath: before.relativePath,
      expectedHash: before.contentHash,
      content
    });
    expect(result.ok).toBe(true);
    const [snapshot] = await versions.list(root, before.relativePath);
    expect(snapshot.reason).toBe('final');
    expect((await versions.read(root, before.relativePath, snapshot.id)).content).toBe(content);
    const saved = await document();
    await workspace.writeDocument({
      rootPath: root,
      relativePath: saved.relativePath,
      expectedHash: saved.contentHash,
      content: `${content}继续编辑。\n`
    });
    expect(await versions.list(root, before.relativePath)).toHaveLength(1);
  });
  it('新建定稿同样留档，快照目录损坏时不写正文', async () => {
    const workspace = new WorkspaceService(
      { getStorageContext: async () => ({ storageMode: 'workspace' as const, workspacePath: root }) },
      {},
      undefined,
      undefined,
      (next, previous) => versions.preserveFinalization(next, previous)
    );
    const created = await workspace.createDocument({
      rootPath: root,
      relativePath: '新章.md',
      content: '---\nkind: chapter\nstatus: final\n---\n已完成。\n'
    });
    expect(created.ok).toBe(true);
    expect((await versions.list(root, '新章.md'))[0]?.reason).toBe('final');
    const otherRoot = path.join(home, 'blocked');
    await mkdir(path.join(otherRoot, '.chaptale'), { recursive: true });
    await writeFile(path.join(otherRoot, '.chaptale/revisions'), '不是目录');
    const blocked = new WorkspaceService(
      { getStorageContext: async () => ({ storageMode: 'workspace' as const, workspacePath: otherRoot }) },
      {},
      undefined,
      undefined,
      (next, previous) => versions.preserveFinalization(next, previous)
    );
    const content = '---\nkind: chapter\nstatus: final\n---\n正文';
    expect(await blocked.createDocument({ rootPath: otherRoot, relativePath: 'new.md', content })).toMatchObject({
      ok: false
    });
    await expect(readFile(path.join(otherRoot, 'new.md'))).rejects.toThrow();
    await writeFile(path.join(otherRoot, 'old.md'), '原稿');
    const before = await readDocumentSnapshot({ rootPath: otherRoot, relativePath: 'old.md' });
    expect(
      await blocked.writeDocument({
        rootPath: otherRoot,
        relativePath: 'old.md',
        content,
        expectedHash: before.contentHash
      })
    ).toMatchObject({ ok: false });
    expect(await readFile(path.join(otherRoot, 'old.md'), 'utf8')).toBe('原稿');
  });
  it('唯一稳定 id 移动后仍发现旧路径和旧格式历史', async () => {
    const before = await document();
    const snapshot = await versions.save(before, 'final');
    const metadataPath = path.join(root, snapshot.contentPath.replace(/\.md$/, '.json'));
    const oldFormat = JSON.parse(await readFile(metadataPath, 'utf8'));
    delete oldFormat.sourceId;
    await writeFile(metadataPath, JSON.stringify(oldFormat));
    await rename(path.join(root, '正文/一.md'), path.join(root, '正文/新一.md'));
    expect((await versions.list(root, '正文/新一.md')).map(item => item.id)).toEqual([snapshot.id]);
    expect((await versions.read(root, '正文/新一.md', snapshot.id)).content).toBe(before.content);
    expect(JSON.parse(await readFile(metadataPath, 'utf8'))).not.toHaveProperty('sourceId');
  });
  it('重复 id 不跨路径合并，复用旧路径的新身份不继承旧历史', async () => {
    const snapshot = await versions.save(await document(), 'accepted');
    await rename(path.join(root, '正文/一.md'), path.join(root, '正文/新一.md'));
    await writeFile(path.join(root, '正文/复制.md'), '---\nid: chapter-one\nkind: chapter\n---\n复制。\n');
    expect(await versions.list(root, '正文/新一.md')).toEqual([]);
    await writeFile(path.join(root, '正文/一.md'), '---\nid: unrelated\nkind: chapter\n---\n另一个章节。\n');
    expect(await versions.list(root, '正文/一.md')).toEqual([]);
    await expect(versions.read(root, '正文/新一.md', snapshot.id)).rejects.toThrow('不存在');
  });
  it('移动后的保留策略覆盖同一身份，final 永久保留', async () => {
    const final = await versions.save(await document(), 'final');
    for (let index = 0; index < 12; index++) await versions.save(await document(), 'accepted');
    await rename(path.join(root, '正文/一.md'), path.join(root, '正文/新一.md'));
    for (let index = 0; index < 12; index++) await versions.save(await document('正文/新一.md'), 'settlement');
    const list = await versions.list(root, '正文/新一.md');
    expect(list).toHaveLength(21);
    expect(list.some(item => item.id === final.id)).toBe(true);
    expect((await versions.read(root, '正文/新一.md', final.id)).snapshot.targetPath).toBe('正文/一.md');
  });
  it('篡改原文和伪造内容引用均拒绝读取', async () => {
    const snapshot = await versions.save(await document(), 'final');
    await writeFile(path.join(root, snapshot.contentPath), '被外部替换');
    await expect(versions.read(root, '正文/一.md', snapshot.id)).rejects.toThrow('已被外部修改');
    await writeFile(
      path.join(root, snapshot.contentPath.replace(/\.md$/, '.json')),
      JSON.stringify({ ...snapshot, contentPath: '正文/一.md' })
    );
    await expect(versions.list(root, '正文/一.md')).rejects.toThrow('记录损坏');
  });
});
