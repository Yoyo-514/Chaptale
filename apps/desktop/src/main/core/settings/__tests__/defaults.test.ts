import { describe, expect, it } from 'vitest';

import type { ChaptaleSettings, UpdateWebToolsSettingsPayload } from '@chaptale/ipc-contract';

import {
  cloneDefaultSettings,
  cloneDefaultWebToolsSettings,
  DEFAULT_WEB_TOOLS_SETTINGS,
  mergeSettings,
  mergeWebToolsSettings
} from '../defaults';

/** 落盘文件不受类型约束：这个助手就是用来把“只给一半字段、或给错类型”喂进去的。 */
function partial(value: Record<string, unknown>): ChaptaleSettings {
  return mergeSettings(value as Partial<ChaptaleSettings>);
}

describe('settings defaults', () => {
  it('returns isolated default settings clones for mutation-safe callers', () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();

    first.workspace.path = 'E:/Stories';

    expect(second.workspace).toEqual({});
  });

  it('merges app settings without carrying web tools fields', () => {
    const settings = mergeSettings({
      workspace: { path: 'E:/Stories' }
    });

    expect(settings).toEqual({
      version: 1,
      workspace: { path: 'E:/Stories' },
      explorer: { showInternalFiles: false },
      editor: { autoSave: false },
      backup: { auto: true, intervalMinutes: 1440 },
      onboarding: { completedVersion: 0 },
      theme: 'dark'
    });
  });

  it('自动备份默认开、默认每日一次；关掉它必须先落一个显式的 false', () => {
    expect(mergeSettings(undefined).backup).toEqual({ auto: true, intervalMinutes: 1440 });
    expect(partial({ backup: { auto: false } }).backup.auto).toBe(false);
    // 手改过的配置里出现 "false"、0 这类值时按默认（开）处理，不让开关的勾选态与取数行为对不上。
    expect(partial({ backup: { auto: 'false' } }).backup.auto).toBe(true);
  });

  it('自动备份间隔回落默认而不是夹取：越界、小数、字符串都不算数', () => {
    // 一次自动备份就是一次整包上传，所以下限真的挡在那里（30 分钟）。
    expect(partial({ backup: { intervalMinutes: 10 } }).backup.intervalMinutes).toBe(1440);
    expect(partial({ backup: { intervalMinutes: 43_201 } }).backup.intervalMinutes).toBe(1440);
    expect(partial({ backup: { intervalMinutes: 90.5 } }).backup.intervalMinutes).toBe(1440);
    expect(partial({ backup: { intervalMinutes: '60' } }).backup.intervalMinutes).toBe(1440);
    // 边界值本身要能落：30 分钟与 30 天。
    expect(partial({ backup: { intervalMinutes: 30 } }).backup.intervalMinutes).toBe(30);
    expect(partial({ backup: { intervalMinutes: 43_200 } }).backup.intervalMinutes).toBe(43_200);
  });

  it('自动保存只接受显式布尔开启，旧设置和错误类型默认关闭', () => {
    expect(mergeSettings(undefined).editor?.autoSave).toBe(false);
    expect(mergeSettings({ editor: { autoSave: true } }).editor?.autoSave).toBe(true);
    expect(
      mergeSettings({ editor: { autoSave: 'true' } } as unknown as Partial<ChaptaleSettings>).editor?.autoSave
    ).toBe(false);
  });

  it('认不出的主题回落默认，而不是原样透传', () => {
    // 落盘文件不受类型约束（手改过的配置、旧版本写下的取值都可能出现），故意绕开类型。
    // 这个值最终会变成 <html> 上的类名——落一个没有对应样式的类，
    // 界面会退化成没有任何语义色的裸样式。
    const settings = mergeSettings({ theme: '将来某个主题' } as unknown as Partial<ChaptaleSettings>);

    expect(settings.theme).toBe('dark');
  });

  it('returns isolated web tools default clones', () => {
    const first = cloneDefaultWebToolsSettings();
    const second = cloneDefaultWebToolsSettings();

    first.search.enabled = false;
    first.fetch.timeoutSeconds = 5;

    expect(second.search.enabled).toBe(true);
    expect(second.fetch.timeoutSeconds).toBe(DEFAULT_WEB_TOOLS_SETTINGS.fetch.timeoutSeconds);
  });
});

describe('mergeWebToolsSettings', () => {
  it('merges nested groups while preserving unsubmitted values', () => {
    const current = cloneDefaultWebToolsSettings();
    const payload: UpdateWebToolsSettingsPayload = {
      search: { enabled: false, provider: 'brave' },
      keys: { braveApiKey: 'bk' }
    };

    const settings = mergeWebToolsSettings(current, payload);

    expect(settings.search).toEqual({ enabled: false, provider: 'brave' });
    expect(settings.keys.braveApiKey).toBe('bk');
    // 未提交分组保持现值。
    expect(settings.fetch.timeoutSeconds).toBe(current.fetch.timeoutSeconds);
    expect(settings.ssrf.allowRanges).toEqual([]);
  });

  it('keeps explicit falsey values instead of replacing them with defaults', () => {
    const current = cloneDefaultWebToolsSettings();
    const settings = mergeWebToolsSettings(current, {
      search: { enabled: false },
      fetch: { timeoutSeconds: 0, maxBytes: 0 },
      ssrf: { allowRanges: [] }
    });

    expect(settings.search.enabled).toBe(false);
    expect(settings.search.provider).toBe('duckduckgo');
    expect(settings.fetch.timeoutSeconds).toBe(0);
    expect(settings.fetch.maxBytes).toBe(0);
    expect(settings.ssrf.allowRanges).toEqual([]);
  });
});
