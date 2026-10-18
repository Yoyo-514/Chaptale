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

    expect(state.paths).toEqual({ rootDir, settingsPath: service.settingsPath, currentCwd: '' });
    expect(JSON.parse(await readFile(service.settingsPath, 'utf8'))).toMatchObject({ version: 1, workspace: {} });
  });

  it('已有设置文件不被默认值覆盖', async () => {
    const service = new SettingsService({ rootDir });
    await writeFile(service.settingsPath, JSON.stringify({ theme: 'light' }));

    await service.getState();

    expect(JSON.parse(await readFile(service.settingsPath, 'utf8'))).toEqual({ theme: 'light' });
  });

  it('打开作品后给出当前作品目录并记入最近作品', async () => {
    const service = new SettingsService({ rootDir });
    const workspacePath = path.join(rootDir, 'Story Workspace');

    const state = await service.update({ workspace: { path: workspacePath } });

    expect(state.paths.currentCwd).toBe(workspacePath);
    expect(state.settings.recentWorkspaces).toEqual([workspacePath]);
    expect(await service.getStorageContext()).toEqual({ workspacePath });
  });

  it('关闭作品时落盘不留空字段', async () => {
    const service = new SettingsService({ rootDir });
    await service.update({ workspace: { path: path.join(rootDir, 'novel') } });

    const closed = await service.update({ workspace: { path: null } });

    expect(closed.settings.workspace).toEqual({});
    expect(closed.paths.currentCwd).toBe('');
    const raw = JSON.parse(await readFile(service.settingsPath, 'utf8')) as { workspace?: { path?: string } };
    expect(raw.workspace).toEqual({});
  });

  it('部分更新只改提交的分组', async () => {
    const service = new SettingsService({ rootDir });
    await service.update({ theme: 'warm', editor: { autoSave: true } });

    const state = await service.update({ explorer: { showInternalFiles: true } });

    expect(state.settings).toMatchObject({
      theme: 'warm',
      editor: { autoSave: true },
      explorer: { showInternalFiles: true }
    });
  });
});
