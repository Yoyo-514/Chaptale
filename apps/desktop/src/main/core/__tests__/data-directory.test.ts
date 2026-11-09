import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { DataDirectory } from '../data-directory';
import { SettingsService } from '../settings/service';

let root: string;
let settings: SettingsService;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-data-directory-'));
  settings = new SettingsService({ rootDir: path.join(root, 'config') });
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

it('首次启动没有作品库时询问位置，选择后保存并保留其他设置', async () => {
  await settings.update({ theme: 'light' });
  const directory = new DataDirectory(settings);
  expect(await directory.status()).toEqual({ kind: 'unset', suggested: path.join(root, 'config', 'data') });
  await expect(directory.resolve()).rejects.toThrow('数据目录尚未就绪');

  const target = path.join(root, '新位置', 'Chaptale');
  expect(await directory.choose(target)).toEqual({ kind: 'ready', path: target, next: null });
  expect(await directory.resolve()).toBe(target);
  const saved = JSON.parse(await readFile(settings.settingsPath, 'utf8'));
  expect(saved).toMatchObject({ theme: 'light', dataDir: target });
  await settings.update({ theme: 'dark' });
  expect((await settings.readSettings()).dataDir).toBe(target);
});

it('旧位置已有作品库时直接沿用，不再询问', async () => {
  const legacy = path.join(root, 'config', 'creation');
  await mkdir(legacy, { recursive: true });
  await writeFile(path.join(legacy, 'library.sqlite'), '');
  expect(await new DataDirectory(settings).status()).toEqual({ kind: 'ready', path: legacy, next: null });
  expect((await settings.readSettings()).dataDir).toBe(legacy);
});

it('只接受空文件夹或已有的 Chaptale 数据文件夹', async () => {
  const directory = new DataDirectory(settings);
  const other = path.join(root, 'other');
  await mkdir(other);
  await writeFile(path.join(other, '笔记.txt'), '');
  await expect(directory.choose(other)).rejects.toThrow('已有其他文件');
  await expect(directory.choose(path.join(other, '笔记.txt'))).rejects.toThrow('请选择文件夹');
  await expect(directory.choose('relative')).rejects.toThrow('完整的文件夹路径');
  expect((await settings.readSettings()).dataDir).toBeUndefined();

  const existing = path.join(root, 'existing');
  await mkdir(existing);
  await writeFile(path.join(existing, 'library.sqlite'), '');
  await writeFile(path.join(existing, 'desktop.ini'), '');
  expect(await directory.choose(existing)).toMatchObject({ kind: 'ready', path: existing });
});

it('记录的目录不存在时报告不可用且不新建；重新选择后可用', async () => {
  const missing = path.join(root, 'E盘', 'Chaptale');
  await settings.setDataDir(missing);
  const directory = new DataDirectory(settings);
  expect(await directory.status()).toMatchObject({ kind: 'unavailable', path: missing });
  await expect(directory.resolve()).rejects.toThrow();
  await expect(readFile(missing)).rejects.toMatchObject({ code: 'ENOENT' });
  await mkdir(missing, { recursive: true });
  expect(await directory.status()).toEqual({ kind: 'ready', path: missing, next: null });
});

it('使用中改选位置时保持当前目录，新位置在重启后生效', async () => {
  const first = path.join(root, 'first');
  const second = path.join(root, 'second');
  const directory = new DataDirectory(settings);
  await directory.choose(first);
  expect(await directory.choose(second)).toEqual({ kind: 'ready', path: first, next: second });
  expect(await directory.resolve()).toBe(first);
  expect(await new DataDirectory(settings).status()).toEqual({ kind: 'ready', path: second, next: null });
});
