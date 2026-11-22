import { describe, expect, it } from 'vitest';

import type { ChaptaleSettings } from '../../../../bridge/settings';
import { cloneDefaultSettings, mergeSettings } from '../defaults';

/** 落盘文件不受类型约束：这个助手就是用来把“只给一半字段、或给错类型”喂进去的。 */
function partial(value: Record<string, unknown>): ChaptaleSettings {
  return mergeSettings(value as Partial<ChaptaleSettings>);
}

describe('settings defaults', () => {
  it('returns isolated default settings clones for mutation-safe callers', () => {
    const first = cloneDefaultSettings();
    const second = cloneDefaultSettings();

    first.theme = 'light';

    expect(second.theme).toBe('dark');
  });

  it('丢弃旧版本留下的字段，只保留当前设置', () => {
    expect(partial({ workspace: { path: 'E:/Stories' }, backup: { auto: false }, theme: 'warm' })).toEqual({
      version: 1,
      editor: { autoSave: false },
      theme: 'warm',
      checkUpdatesOnStartup: true
    });
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
});
