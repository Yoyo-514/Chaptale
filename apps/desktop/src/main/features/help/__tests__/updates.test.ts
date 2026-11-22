import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { SettingsService } from '../../../core/settings/service';
import { createUpdateChecker } from '../updates';

const repository = 'https://github.com/chaptale-test/chaptale';
const notes = '## 更新说明\n- 增加快捷键一览';
let server: Server;
let rootDir: string;
let endpoint: string;
let status: number;
let response: unknown;

beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'chaptale-updates-'));
  status = 200;
  response = { tag_name: 'v0.10.0', body: notes };
  server = createServer((_, outgoing) => {
    outgoing.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(response));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  endpoint = `http://127.0.0.1:${(server.address() as AddressInfo).port}/releases/latest`;
});

afterEach(async () => {
  await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  await rm(rootDir, { recursive: true, force: true });
});

function checker(currentVersion: string) {
  return createUpdateChecker({
    currentVersion,
    endpoint,
    repository,
    request: fetch,
    settings: new SettingsService({ rootDir })
  });
}

it('识别更高的正式版，重启后保留新版入口但不重复提醒', async () => {
  const expected = { version: '0.10.0', notes, downloadUrl: `${repository}/releases/tag/v0.10.0` };
  const updates = checker('0.9.12');
  await expect(updates.getState()).resolves.toEqual({ checkOnStartup: true, available: null });
  await expect(updates.check()).resolves.toEqual({ kind: 'available', update: expected, announce: true });

  const restarted = checker('0.9.12');
  await expect(restarted.getState()).resolves.toEqual({ checkOnStartup: true, available: expected });
  await expect(restarted.check()).resolves.toEqual({ kind: 'available', update: expected, announce: false });

  const upgraded = checker('0.10.0');
  await expect(upgraded.getState()).resolves.toEqual({ checkOnStartup: true, available: null });
  await expect(upgraded.check()).resolves.toEqual({ kind: 'current', version: '0.10.0' });
});

it('关闭启动检查后仍可手动检查；失败保留已经找到的新版', async () => {
  const settings = new SettingsService({ rootDir });
  await settings.update({ checkUpdatesOnStartup: false });
  const updates = checker('0.1.0');
  await expect(updates.getState()).resolves.toEqual({ checkOnStartup: false, available: null });
  await expect(updates.check()).resolves.toMatchObject({ kind: 'available', announce: true });

  status = 503;
  await expect(updates.check()).rejects.toThrow('GitHub 返回 HTTP 503');
  await expect(updates.getState()).resolves.toMatchObject({ checkOnStartup: false, available: { version: '0.10.0' } });
});

it('GitHub 暂无正式发布时给出独立结果', async () => {
  status = 404;
  await expect(checker('0.1.0').check()).resolves.toEqual({ kind: 'unpublished' });
});

it('同版本的正式版可更新预览版；高于最新发布的构建无需更新', async () => {
  await expect(checker('0.10.0-rc.1').check()).resolves.toMatchObject({
    kind: 'available',
    update: { version: '0.10.0' }
  });
  await expect(checker('0.11.0').check()).resolves.toEqual({ kind: 'current', version: '0.11.0' });
});

it('GitHub 误返回不是发布说明的响应时报告格式错误', async () => {
  response = { tag_name: 'main', body: null };
  await expect(checker('0.1.0').check()).rejects.toThrow('发布信息格式不正确');
});
