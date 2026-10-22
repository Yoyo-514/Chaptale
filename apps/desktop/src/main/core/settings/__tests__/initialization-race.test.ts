import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsService } from '../service';

let root: string;

beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-settings-race-'));
});

afterEach(async () => {
  expect(path.dirname(path.resolve(root))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root).startsWith('chaptale-settings-race-')).toBe(true);
  await rm(root, { recursive: true, force: true });
});

describe('设置初始化与更新', () => {
  it('更新已经入队时，配置初始化必须等待写入再检查文件是否存在', async () => {
    const service = new SettingsService({ rootDir: root });
    const update = service.update({ theme: 'light' });
    // 让已入队的更新开始真实 I/O；初始化不能在队列外凭旧的缺失检查回填默认值。
    await Promise.resolve();
    await Promise.all([update, service.ensureSettingsFile()]);

    expect((await service.readSettings()).theme).toBe('light');
  });

  it('并发补齐初始配置不能覆盖刚保存的偏好', async () => {
    for (let index = 0; index < 20; index += 1) {
      const rootDir = path.join(root, String(index));
      await mkdir(rootDir);
      const service = new SettingsService({ rootDir });

      await Promise.all([
        service.getState(),
        service.ensureSettingsFile(),
        service.update({ theme: 'light' }),
        service.update({ editor: { autoSave: true } })
      ]);

      expect(JSON.parse(await readFile(service.settingsPath, 'utf8')), `第 ${index + 1} 次冷启动`).toEqual({
        version: 1,
        theme: 'light',
        editor: { autoSave: true }
      });
    }
  });
});
