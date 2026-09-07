import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceService } from '../service';

let root: string;
let cwd: string;
let service: WorkspaceService;
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-write-document-'));
  cwd = path.join(root, 'workspace');
  await mkdir(cwd);
  service = new WorkspaceService({
    getStorageContext: async () => ({ storageMode: 'workspace' as const, workspacePath: cwd })
  });
});

afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-write-document-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});

describe('文档受控保存', () => {
  it('按原始字节 hash 保存，返回新快照且不改写元数据与换行', async () => {
    const before = '\uFEFF---\r\nwords: 1\r\n---\r\n正文\n';
    const content = before + '续写\r\n';
    await writeFile(path.join(cwd, 'chapter.md'), before);
    expect(
      await service.writeDocument({ rootPath: cwd, relativePath: 'chapter.md', expectedHash: hash(before), content })
    ).toMatchObject({ ok: true, document: { content, contentHash: hash(content) } });
    expect(await readFile(path.join(cwd, 'chapter.md'), 'utf8')).toBe(content);
  });

  it('磁盘已变时拒绝覆盖，之后可用新基线重试', async () => {
    await writeFile(path.join(cwd, 'chapter.md'), '外部变更');
    const args = { rootPath: cwd, relativePath: 'chapter.md', expectedHash: hash('旧文'), content: '本地修改' };
    expect(await service.writeDocument(args)).toMatchObject({ ok: false, code: 'conflict' });
    expect(await readFile(path.join(cwd, 'chapter.md'), 'utf8')).toBe('外部变更');
    expect(await service.writeDocument({ ...args, expectedHash: hash('外部变更') })).toMatchObject({ ok: true });
  });

  it('同基线并发保存最多一项成功，失败不阻塞后续保存', async () => {
    await writeFile(path.join(cwd, 'chapter.md'), '原文');
    const args = { rootPath: cwd, relativePath: 'chapter.md', expectedHash: hash('原文') };
    const results = await Promise.all([
      service.writeDocument({ ...args, content: '第一项' }),
      service.writeDocument({ ...args, content: '第二项' })
    ]);
    expect(results.filter(result => result.ok)).toHaveLength(1);
    expect(results.filter(result => !result.ok)).toMatchObject([{ ok: false, code: 'conflict' }]);
    const written = await readFile(path.join(cwd, 'chapter.md'), 'utf8');
    expect(await service.writeDocument({ ...args, expectedHash: hash(written), content: '最终' })).toMatchObject({
      ok: true
    });
  });

  it('拒绝工作区过期、越界和删除后自动重建', async () => {
    const args = { rootPath: cwd, relativePath: 'missing.md', expectedHash: hash('原文'), content: '新文' };
    expect(await service.writeDocument(args)).toMatchObject({ ok: false, code: 'not-found' });
    expect(await service.writeDocument({ ...args, rootPath: `${cwd}-old` })).toMatchObject({
      ok: false,
      code: 'workspace-changed'
    });
    expect(await service.writeDocument({ ...args, relativePath: '../outside.md' })).toMatchObject({
      ok: false,
      code: 'outside-workspace'
    });
  });

  it('拒绝目录链接逃逸且不损坏外部文件', async () => {
    const outside = path.join(root, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'chapter.md'), '不可改写');
    await symlink(outside, path.join(cwd, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');
    expect(
      await service.writeDocument({
        rootPath: cwd,
        relativePath: 'escape/chapter.md',
        expectedHash: hash('不可改写'),
        content: '错误'
      })
    ).toMatchObject({ ok: false, code: 'outside-workspace' });
    expect(await readFile(path.join(outside, 'chapter.md'), 'utf8')).toBe('不可改写');
  });

  it('拒绝无效 Unicode 和 NUL，不静默替换字符', async () => {
    await writeFile(path.join(cwd, 'chapter.md'), '原文');
    const args = { rootPath: cwd, relativePath: 'chapter.md', expectedHash: hash('原文') };
    for (const content of ['\uD800', 'a\0b']) {
      expect(await service.writeDocument({ ...args, content })).toMatchObject({ ok: false, code: 'invalid-content' });
    }
    expect(await readFile(path.join(cwd, 'chapter.md'), 'utf8')).toBe('原文');
  });
});
