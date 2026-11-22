import { klona } from 'klona';

import type { ChaptaleSettings } from '../../../bridge/settings';
import { isChaptaleTheme } from '../../../bridge/settings';

export const SETTINGS_VERSION = 1;

export const DEFAULT_SETTINGS: ChaptaleSettings = {
  version: SETTINGS_VERSION,
  editor: { autoSave: false },
  // 与 Renderer 的 index.html 上那个静态主题类必须一致：
  // 两者不一致时每次冷启动都会先画一帧再跳色。
  theme: 'dark'
};

/** 返回隔离的默认配置，避免调用方修改共享常量后污染后续初始化。 */
export function cloneDefaultSettings(): ChaptaleSettings {
  return klona(DEFAULT_SETTINGS);
}

/** 根据磁盘内容重建当前版本的应用设置。 */
export function mergeSettings(value: Partial<ChaptaleSettings> | undefined): ChaptaleSettings {
  return {
    version: SETTINGS_VERSION,
    editor: { autoSave: value?.editor?.autoSave === true },
    // 认不出的主题回落默认，而不是原样透传：这个值最终会变成 <html> 上的类名，
    // 落一个没有对应样式的类，界面会退化成没有任何语义色的裸样式。
    theme: value && isChaptaleTheme(value.theme) ? value.theme : DEFAULT_SETTINGS.theme,
    ...(typeof value?.dataDir === 'string' && { dataDir: value.dataDir }),
    ...(typeof value?.installId === 'string' && { installId: value.installId })
  };
}
