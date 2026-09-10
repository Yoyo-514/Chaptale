import { mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UpdateChaptaleSettingsArgsValidator, type ChaptaleSettings } from '@chaptale/ipc-contract';

import { WebToolsSettingsAdapter } from '../../../features/web-tools/adapter';
import { mergeSettings } from '../defaults';
import { SettingsService } from '../service';

let root: string;
beforeEach(async () => {
  root = await mkdtemp(path.join(os.tmpdir(), 'chaptale-onboarding-settings-'));
});
afterEach(async () => {
  expect(path.dirname(root)).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(root)).toMatch(/^chaptale-onboarding-settings-/);
  await rm(root, { recursive: true, force: true });
});
const service = () => new SettingsService(new WebToolsSettingsAdapter(), { rootDir: root });
describe('引导完成标记', () => {
  it('缺省未完成，错误类型与越界版本不绕过引导', () => {
    expect(mergeSettings(undefined).onboarding).toEqual({ completedVersion: 0 });
    for (const completedVersion of [-1, 1.5, 1001, '1', null]) {
      const input = { onboarding: { completedVersion } } as unknown as Partial<ChaptaleSettings>;
      expect(mergeSettings(input).onboarding).toEqual({ completedVersion: 0 });
      expect(UpdateChaptaleSettingsArgsValidator.Check([input])).toBe(false);
    }
    expect(UpdateChaptaleSettingsArgsValidator.Check([{ onboarding: { completedVersion: 1 } }])).toBe(true);
  });
  it('完成和写作偏好一同落盘，重启与独立更新保留标记', async () => {
    const first = service();
    await first.update({ onboarding: { completedVersion: 1 }, theme: 'light', editor: { autoSave: true } });
    const second = service();
    await second.update({ theme: 'warm' });
    expect((await second.getState()).settings).toMatchObject({
      onboarding: { completedVersion: 1 },
      theme: 'warm',
      editor: { autoSave: true }
    });
    expect(JSON.parse(await readFile(first.settingsPath, 'utf8')).onboarding).toEqual({ completedVersion: 1 });
  });
  it('并发设置更新不丢完成标记，也不改变存储范围', async () => {
    const settings = service();
    await Promise.all([
      settings.update({ onboarding: { completedVersion: 1 } }),
      settings.update({ theme: 'light' }),
      settings.update({ editor: { autoSave: true } })
    ]);
    expect((await settings.getState()).settings).toMatchObject({
      workspace: {},
      onboarding: { completedVersion: 1 },
      theme: 'light',
      editor: { autoSave: true }
    });
  });
});
