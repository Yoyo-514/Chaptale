import { mkdtemp, mkdir, rm, symlink, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { globToRegExp, isBinaryContent, resolveWithinCwd } from '../path-guard';

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-path-guard-'));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe('globToRegExp', () => {
  it('* 单段匹配（不跨 /）；? 单字符；字面量转义', () => {
    const md = globToRegExp('*.md');

    expect(md.test('a.md')).toBe(true);
    expect(md.test('a/b.md')).toBe(false);
    expect(md.test('amd')).toBe(false);

    expect(globToRegExp('file?.txt').test('file1.txt')).toBe(true);
    expect(globToRegExp('file?.txt').test('file12.txt')).toBe(false);

    expect(globToRegExp('a+b.txt').test('a+b.txt')).toBe(true);
    expect(globToRegExp('a+b.txt').test('aab.txt')).toBe(false);
  });

  it('** 跨目录；a/**/b 同时命中 a/b', () => {
    const deep = globToRegExp('**/*.json');

    expect(deep.test('a.json')).toBe(true);
    expect(deep.test('x/y/z/a.json')).toBe(true);

    const mid = globToRegExp('a/**/b.md');

    expect(mid.test('a/b.md')).toBe(true);
    expect(mid.test('a/x/y/b.md')).toBe(true);
    expect(mid.test('x/a/b.md')).toBe(false);
  });

  it('**/ 只跨完整目录，不吞掉目标文件名的前缀', () => {
    const pattern = globToRegExp('chapters/**/draft.md');

    expect(pattern.test('chapters/draft.md')).toBe(true);
    expect(pattern.test('chapters/part/scene/draft.md')).toBe(true);
    expect(pattern.test('chapters/old-draft.md')).toBe(false);
    expect(pattern.test('chapters/part/not-draft.md')).toBe(false);
  });
});

describe('isBinaryContent', () => {
  it('NUL 字节判二进制；纯文本放行', () => {
    expect(isBinaryContent(Buffer.from([0x89, 0x50, 0x00, 0x0a]))).toBe(true);
    expect(isBinaryContent(Buffer.from('普通文本内容'))).toBe(false);
    // NUL 在 8KB 之后：探测窗口外放行（首块采样）。
    const late = Buffer.alloc(9000, 0x61);
    late[8900] = 0;
    expect(isBinaryContent(late)).toBe(false);
  });
});

describe('resolveWithinCwd', () => {
  it('词法越界（../ 序列）直接拒绝', async () => {
    await expect(resolveWithinCwd(path.join(dir, 'ws'), '../outside.txt')).rejects.toThrow(/作品之外/);
  });

  it('作品内路径放行；相对路径与绝对路径等价', async () => {
    await mkdir(path.join(dir, 'ws'), { recursive: true });
    await writeFile(path.join(dir, 'ws', 'a.txt'), 'x');

    await expect(resolveWithinCwd(path.join(dir, 'ws'), 'a.txt')).resolves.toBe(path.join(dir, 'ws', 'a.txt'));
    await expect(resolveWithinCwd(path.join(dir, 'ws'), './a.txt')).resolves.toBe(path.join(dir, 'ws', 'a.txt'));
  });

  it('cwd 本身是符号链接时按真实路径放行', async () => {
    await mkdir(path.join(dir, 'real-ws'), { recursive: true });
    await writeFile(path.join(dir, 'real-ws', 'a.txt'), 'x');
    const link = path.join(dir, 'ws-link');
    await symlink(path.join(dir, 'real-ws'), link, 'dir');

    await expect(resolveWithinCwd(link, 'a.txt')).resolves.toBe(path.join(link, 'a.txt'));
  });

  it('作品内符号链接指向外部：realpath 复核拒绝', async () => {
    await mkdir(path.join(dir, 'ws'), { recursive: true });
    await mkdir(path.join(dir, 'outside'), { recursive: true });
    await writeFile(path.join(dir, 'outside', 'secret.txt'), '机密');
    await symlink(path.join(dir, 'outside'), path.join(dir, 'ws', 'escape'), 'dir');

    await expect(resolveWithinCwd(path.join(dir, 'ws'), 'escape/secret.txt')).rejects.toThrow(/符号链接目标越界/);
  });

  it('目标不存在时按最近存在祖先校验（新建文件放行）', async () => {
    await mkdir(path.join(dir, 'ws'), { recursive: true });

    await expect(resolveWithinCwd(path.join(dir, 'ws'), 'new/deep/file.md')).resolves.toBe(
      path.join(dir, 'ws', 'new', 'deep', 'file.md')
    );
  });

  it('超过 64 层的未创建目录仍检查符号链接边界', async () => {
    const workspace = path.join(dir, 'ws');
    const outside = path.join(dir, 'outside');
    await mkdir(workspace);
    await mkdir(outside);
    await symlink(outside, path.join(workspace, 'escape'), 'junction');
    const target = ['escape', ...Array.from({ length: 70 }, () => 'd'), 'file.md'].join('/');

    await expect(resolveWithinCwd(workspace, target)).rejects.toThrow(/符号链接目标越界/);
  });

  it('文件系统根目录也能作为边界，不因重复分隔符拒绝子路径', async () => {
    await expect(resolveWithinCwd(path.parse(dir).root, dir)).resolves.toBe(dir);
  });

  it('普通文件不能冒充新文件的父目录', async () => {
    await writeFile(path.join(dir, 'file'), '不是目录');

    await expect(resolveWithinCwd(dir, 'file/child.md')).rejects.toThrow();
  });
});
