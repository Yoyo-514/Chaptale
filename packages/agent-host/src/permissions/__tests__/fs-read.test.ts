import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, parse } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { inspectFsReadTarget, matchesFsReadPermission } from '../fs-read.ts';

let root: string;
let cwd: string;
let fakeHome: string;

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-cwd-paths-'));
  cwd = join(root, 'work');
  fakeHome = join(root, 'fake-home');
  await mkdir(cwd, { recursive: true });
  await mkdir(fakeHome, { recursive: true });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('只读文件工具路径解析与记住范围', () => {
  it('工作目录内直接放行，目录外单文件提升到父目录记住并覆盖同目录只读调用', async () => {
    const refDir = join(root, 'references', 'ming');
    const siblingDir = join(root, 'references', 'qing');
    await mkdir(join(refDir, 'chapters'), { recursive: true });
    await mkdir(siblingDir, { recursive: true });
    await writeFile(join(cwd, 'inside.txt'), '目录内');
    await writeFile(join(refDir, 'officials.txt'), '职官志');
    await writeFile(join(refDir, 'chapters', 'vol1.txt'), '卷一');
    await writeFile(join(siblingDir, 'other.txt'), '清史');

    const insideRes = await inspectFsReadTarget('read', { path: 'inside.txt' }, cwd, { homeDir: fakeHome });
    expect(insideRes?.inCwd).toBe(true);

    const fileRes = await inspectFsReadTarget('read', { path: join(refDir, 'officials.txt') }, cwd, {
      homeDir: fakeHome
    });
    const realRefDir = await realpath(refDir);
    expect(fileRes).toEqual({
      inCwd: false,
      target: join(realRefDir, 'officials.txt'),
      remember: { capability: 'fs_read', path: realRefDir, pathKind: 'directory' }
    });

    const rule = fileRes!.remember!;
    const lsSub = await inspectFsReadTarget('ls', { path: join(refDir, 'chapters') }, cwd, { homeDir: fakeHome });
    const grepSub = await inspectFsReadTarget('grep', { path: join(refDir, 'chapters', 'vol1.txt') }, cwd, {
      homeDir: fakeHome
    });
    const sibling = await inspectFsReadTarget('read', { path: join(siblingDir, 'other.txt') }, cwd, {
      homeDir: fakeHome
    });
    expect(matchesFsReadPermission(rule, lsSub!.target!)).toBe(true);
    expect(matchesFsReadPermission(rule, grepSub!.target!)).toBe(true);
    expect(matchesFsReadPermission(rule, sibling!.target!)).toBe(false);
  });

  it('盘符根与用户主目录本身不可记住，直属单文件降级只记单文件', async () => {
    const homeNote = join(fakeHome, 'note.txt');
    const homeOther = join(fakeHome, 'other.txt');
    await writeFile(homeNote, '笔记');
    await writeFile(homeOther, '另一份');

    const lsHome = await inspectFsReadTarget('ls', { path: fakeHome }, cwd, { homeDir: fakeHome });
    expect(lsHome?.inCwd).toBe(false);
    expect(lsHome?.remember).toBeUndefined();

    const driveRoot = parse(root).root;
    const lsDrive = await inspectFsReadTarget('ls', { path: driveRoot }, cwd, { homeDir: fakeHome });
    expect(lsDrive?.inCwd).toBe(false);
    expect(lsDrive?.remember).toBeUndefined();

    const readHomeFile = await inspectFsReadTarget('read', { path: homeNote }, cwd, { homeDir: fakeHome });
    const realNote = await realpath(homeNote);
    const realOther = await realpath(homeOther);
    expect(readHomeFile?.remember).toEqual({
      capability: 'fs_read',
      path: realNote,
      pathKind: 'file'
    });
    expect(matchesFsReadPermission(readHomeFile!.remember!, realNote)).toBe(true);
    expect(matchesFsReadPermission(readHomeFile!.remember!, realOther)).toBe(false);
    expect(matchesFsReadPermission(readHomeFile!.remember!, await realpath(fakeHome))).toBe(false);
  });

  it('已授权目录内指向外部目录的链接按外部真实路径求值，特殊路径语法仅允许单次授权', async () => {
    const allowedDir = join(root, 'allowed');
    const secretDir = join(root, 'secret');
    await mkdir(allowedDir, { recursive: true });
    await mkdir(secretDir, { recursive: true });
    await writeFile(join(secretDir, 'hidden.txt'), '机密');
    await symlink(secretDir, join(allowedDir, 'escape'), process.platform === 'win32' ? 'junction' : 'dir');

    const rule = { path: await realpath(allowedDir), pathKind: 'directory' as const };
    const escaped = await inspectFsReadTarget('read', { path: join(allowedDir, 'escape', 'hidden.txt') }, cwd, {
      homeDir: fakeHome
    });
    expect(escaped?.inCwd).toBe(false);
    expect(matchesFsReadPermission(rule, escaped!.target!)).toBe(false);

    const tilde = await inspectFsReadTarget('read', { path: '~/notes.txt' }, cwd, { homeDir: fakeHome });
    expect(tilde).toEqual({ inCwd: false });
  });
});
