import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { SettingsService } from '../service';

let rootDir: string;

beforeEach(async () => {
  rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-settings-service-'));
});

afterEach(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('SettingsService', () => {
  it('首次读取时补齐 settings.json', async () => {
    const service = new SettingsService({ rootDir });

    const state = await service.getState();

    expect(state.paths).toEqual({ rootDir, settingsPath: service.settingsPath });
    expect(JSON.parse(await readFile(service.settingsPath, 'utf8'))).toEqual({
      version: 1,
      editor: { autoSave: false },
      theme: 'dark'
    });
  });

  it('已有设置文件不被默认值覆盖', async () => {
    const service = new SettingsService({ rootDir });
    await writeFile(service.settingsPath, JSON.stringify({ theme: 'light' }));

    await service.getState();

    expect(JSON.parse(await readFile(service.settingsPath, 'utf8'))).toEqual({ theme: 'light' });
  });

  it('部分更新只改提交的分组', async () => {
    const service = new SettingsService({ rootDir });
    await service.update({ theme: 'warm', editor: { autoSave: true } });

    const state = await service.update({ theme: 'light' });

    expect(state.settings).toEqual({ version: 1, theme: 'light', editor: { autoSave: true } });
  });

  it('安装标识第一次用到时生成，之后保持不变，改别的设置也不丢', async () => {
    const service = new SettingsService({ rootDir });
    const installId = await service.installId();

    await service.update({ theme: 'light' });

    expect(await service.installId()).toBe(installId);
    expect(await new SettingsService({ rootDir }).installId()).toBe(installId);
  });
});
