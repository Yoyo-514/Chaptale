import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { WorkspaceService } from '../service';

let testRoot: string;
let workspacePath: string | undefined;

const settings = {
  getStorageContext: async () => ({
    storageMode: workspacePath ? ('workspace' as const) : ('global' as const),
    workspacePath
  })
};

beforeEach(async () => {
  testRoot = await mkdtemp(path.join(os.tmpdir(), 'chaptale-read-document-'));
  workspacePath = path.join(testRoot, 'workspace');
  await mkdir(workspacePath);
});

afterEach(async () => {
  expect(path.dirname(path.resolve(testRoot))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(testRoot).startsWith('chaptale-read-document-')).toBe(true);
  await rm(testRoot, { recursive: true, force: true });
});

async function documentFile(content: string | Buffer, name = 'chapter.md') {
  const rootPath = workspacePath!;
  const target = path.join(rootPath, name);
  await writeFile(target, content);
  return { rootPath, relativePath: name };
}

describe('工作区文档读取', () => {
  it('返回完整原文、字节数、文件时间和实际字节的 SHA-256', async () => {
    const content = '\uFEFF---\r\ntitle: 初雪\r\n---\r\n第一行。\r\n第二行。\n末行';
    const args = await documentFile(content);
    const before = await stat(path.join(args.rootPath, args.relativePath));
    const result = await new WorkspaceService(settings).readDocument(args);

    expect(result).toEqual({
      ok: true,
      document: {
        ...args,
        content,
        sizeBytes: Buffer.byteLength(content),
        mtimeMs: before.mtimeMs,
        contentHash: createHash('sha256').update(Buffer.from(content)).digest('hex'),
        head: { status: 'ok', frontmatter: { title: '初雪' }, body: '第一行。\r\n第二行。\n末行' }
      }
    });
    expect(await readFile(path.join(args.rootPath, args.relativePath), 'utf8')).toBe(content);
    expect((await stat(path.join(args.rootPath, args.relativePath))).mtimeMs).toBe(before.mtimeMs);
  });

  it.each(['', '普通正文\n', '\uFEFF无元数据\r\n', '正文\n---\ntitle: 不是文件头\n---\n'])(
    '没有 frontmatter 时完整保留正文：%j',
    async content => {
      const args = await documentFile(content);
      expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({
        ok: true,
        document: { content, head: { status: 'none', body: content } }
      });
    }
  );

  it.each(['---\n---\n正文', '---\r\n# 注释\r\n---\r\n正文'])('空 frontmatter 合法：%j', async content => {
    const args = await documentFile(content);
    expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({
      ok: true,
      document: { content, head: { status: 'ok', frontmatter: {}, body: '正文' } }
    });
  });

  it('支持作品规范中的嵌套列表、多行值和中文字段，不执行 HTML', async () => {
    const content = [
      '---',
      'title: 林晚',
      '别称: [小晚, "林, 晚"]',
      'relations:',
      '  - { to: "[[顾沉]]", type: 师徒, note: 尚不知其真实身份 }',
      'description: |',
      '  第一行',
      '  第二行',
      '---',
      '<script>alert("只作为原文")</script>'
    ].join('\n');
    const args = await documentFile(content);

    expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({
      ok: true,
      document: {
        content,
        head: {
          status: 'ok',
          frontmatter: {
            title: '林晚',
            别称: ['小晚', '林, 晚'],
            relations: [{ to: '[[顾沉]]', type: '师徒', note: '尚不知其真实身份' }],
            description: '第一行\n第二行\n'
          },
          body: '<script>alert("只作为原文")</script>'
        }
      }
    });
  });

  it.each(
    [
      '---\ntitle: 未闭合\n正文',
      '---\ntitle: [没有结束\n---\n正文',
      '---\ntitle: "没有结束\n---\n正文',
      '---\ntitle: 一\ntitle: 二\n---\n正文',
      '---\n- 顶层列表\n---\n正文',
      '---\nvalue: !unknown 数据\n---\n正文',
      '---\na: &a [*a]\n---\n正文',
      `---\ntitle: ${'长'.repeat(24_000)}\n---\n正文`
    ].map((content, index) => ({ content, index }))
  )('无效元数据 $index 保留整个原文件', async ({ content }) => {
    const args = await documentFile(content);
    const result = await new WorkspaceService(settings).readDocument(args);

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.document.head.status).toBe('invalid');
      expect(result.document.head).toMatchObject({ error: expect.any(String) });
      expect(result.document.content === content).toBe(true);
      expect(result.document.head.body === content).toBe(true);
    }
    expect(await readFile(path.join(args.rootPath, args.relativePath), 'utf8')).toBe(content);
  });

  it('没有工作区时不回退到全局目录', async () => {
    const args = await documentFile('正文');
    workspacePath = undefined;
    expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({
      ok: false,
      code: 'no-workspace'
    });
  });

  it('拒绝旧工作区发来的读取请求', async () => {
    const args = await documentFile('工作区 A');
    workspacePath = path.join(testRoot, 'another');
    await mkdir(workspacePath);
    await writeFile(path.join(workspacePath, args.relativePath), '工作区 B');

    expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({
      ok: false,
      code: 'workspace-changed'
    });
  });

  it('读取过程中切换工作区，旧结果失效', async () => {
    const args = await documentFile('工作区 A');
    const pending = new WorkspaceService(settings).readDocument(args);
    workspacePath = undefined;

    expect(await pending).toMatchObject({ ok: false, code: 'workspace-changed' });
  });

  it.each([
    '',
    '.',
    './chapter.md',
    '..',
    '../chapter.md',
    'a/../chapter.md',
    '/chapter.md',
    'a//b',
    'a/',
    'E:/a',
    'a\\b',
    'a\0b'
  ])('拒绝非法相对路径：%j', async relativePath => {
    expect(await new WorkspaceService(settings).readDocument({ rootPath: workspacePath!, relativePath })).toMatchObject(
      { ok: false, code: 'outside-workspace' }
    );
  });

  it('拒绝目录链接逃逸，允许工作区内的目录链接', async () => {
    const outside = path.join(testRoot, 'outside');
    await mkdir(outside);
    await writeFile(path.join(outside, 'secret.md'), '不可读取');
    await mkdir(path.join(workspacePath!, 'inside'));
    await writeFile(path.join(workspacePath!, 'inside', 'chapter.md'), '可以读取');
    const linkType = process.platform === 'win32' ? 'junction' : 'dir';
    await symlink(outside, path.join(workspacePath!, 'escape'), linkType);
    await symlink(path.join(workspacePath!, 'inside'), path.join(workspacePath!, 'shortcut'), linkType);
    const service = new WorkspaceService(settings);

    expect(await service.readDocument({ rootPath: workspacePath!, relativePath: 'escape/secret.md' })).toMatchObject({
      ok: false,
      code: 'outside-workspace'
    });
    expect(await service.readDocument({ rootPath: workspacePath!, relativePath: 'shortcut/chapter.md' })).toMatchObject(
      { ok: true, document: { content: '可以读取' } }
    );
  });

  it('区分不存在、目录和二进制文件', async () => {
    await mkdir(path.join(workspacePath!, 'directory'));
    await documentFile(Buffer.from([0x50, 0x4e, 0x47, 0x00]), 'binary.md');
    const service = new WorkspaceService(settings);

    expect(await service.readDocument({ rootPath: workspacePath!, relativePath: 'missing.md' })).toMatchObject({
      ok: false,
      code: 'not-found'
    });
    expect(await service.readDocument({ rootPath: workspacePath!, relativePath: 'directory' })).toMatchObject({
      ok: false,
      code: 'not-a-file'
    });
    expect(await service.readDocument({ rootPath: workspacePath!, relativePath: 'binary.md' })).toMatchObject({
      ok: false,
      code: 'binary-file'
    });
  });

  it('拒绝无效 UTF-8，不用替换字符静默损失原文', async () => {
    const args = await documentFile(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
    expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({
      ok: false,
      code: 'unsupported-encoding'
    });
  });

  it('按字节计数，允许恰好达到上限，超出一个字节也不截断', async () => {
    const args = await documentFile('汉字');
    const service = new WorkspaceService(settings, { maxBytes: 6 });

    expect(await service.readDocument(args)).toMatchObject({ ok: true, document: { content: '汉字', sizeBytes: 6 } });
    await writeFile(path.join(args.rootPath, args.relativePath), '汉字!');
    expect(await service.readDocument(args)).toMatchObject({ ok: false, code: 'too-large' });
    expect(await readFile(path.join(args.rootPath, args.relativePath), 'utf8')).toBe('汉字!');
  });

  it('默认拒绝大于 100 MiB 的文件', async () => {
    const args = await documentFile('');
    const file = await open(path.join(args.rootPath, args.relativePath), 'r+');
    try {
      await file.truncate(100 * 1024 * 1024 + 1);
    } finally {
      await file.close();
    }

    expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({ ok: false, code: 'too-large' });
  });

  it('真实文件在读取期限耗尽时返回超时，之后仍可正常读取', async () => {
    const args = await documentFile('正文');

    expect(await new WorkspaceService(settings, { timeoutMs: 0 }).readDocument(args)).toMatchObject({
      ok: false,
      code: 'read-timeout'
    });
    expect(await new WorkspaceService(settings).readDocument(args)).toMatchObject({
      ok: true,
      document: { content: '正文' }
    });
  });

  it('非零期限会中止真实大文件读取，超时不会污染后续请求', async () => {
    const args = await documentFile(Buffer.alloc(16 * 1024 * 1024, 'x'));
    expect(await new WorkspaceService(settings, { timeoutMs: 1 }).readDocument(args)).toMatchObject({
      ok: false,
      code: 'read-timeout'
    });
    const result = await new WorkspaceService(settings).readDocument(args);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.document.sizeBytes).toBe(16 * 1024 * 1024);
  });

  it('调用方可收紧字节预算，不能放宽默认上限', async () => {
    const args = await documentFile('正文');
    expect(await new WorkspaceService(settings).readDocument({ ...args, maxBytes: 5 })).toMatchObject({
      ok: false,
      code: 'too-large'
    });
    const empty = await documentFile('');
    expect(await new WorkspaceService(settings).readDocument({ ...empty, maxBytes: 0 })).toMatchObject({
      ok: true,
      document: { sizeBytes: 0 }
    });
  });

  it('YAML 原型键只作为元数据字段，不污染对象原型', async () => {
    const args = await documentFile('---\n__proto__:\n  polluted: true\nconstructor: 文本\n---\n正文');
    const result = await new WorkspaceService(settings).readDocument(args);
    expect(result.ok).toBe(true);
    if (result.ok && result.document.head.status === 'ok') {
      expect(Object.hasOwn(result.document.head.frontmatter, '__proto__')).toBe(true);
      expect(result.document.head.frontmatter.constructor).toBe('文本');
    } else {
      expect.fail('应保留普通元数据字段');
    }
    expect('polluted' in {}).toBe(false);
  });
});
