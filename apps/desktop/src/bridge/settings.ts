import type { Static } from 'typebox';

import type { ChaptaleThemeSchema, UpdateChaptaleSettingsPayloadSchema } from './schemas/settings';

/** 界面主题；每个取值对应样式表里的一套语义色。 */
export type ChaptaleTheme = Static<typeof ChaptaleThemeSchema>;

/**
 * 主题取值表。
 *
 * 写成 Record 而不是数组，是为了把它和 schema 双向钉死：schema 增了取值这里缺分支、
 * 或这里多写一个 schema 没有的取值，两种漂移都在编译期失败。
 */
const THEME_VALUES: Record<ChaptaleTheme, true> = { light: true, warm: true, dark: true };

/**
 * 主题取值守卫。
 *
 * schema 只把住 IPC 入口，落盘的设置文件与 Renderer 的启动期缓存都是直接读的——
 * 手改过的配置、以及旧版本写下的取值，都要在用之前挡掉。
 */
export function isChaptaleTheme(value: unknown): value is ChaptaleTheme {
  return typeof value === 'string' && Object.hasOwn(THEME_VALUES, value);
}

export type ChaptaleSettings = {
  version: 1;
  editor?: { autoSave: boolean };
  /** 界面主题；缺省由主进程补齐，Renderer 拿到的一定是确定值。 */
  theme: ChaptaleTheme;
};

export type ChaptaleSettingsPaths = {
  rootDir: string;
  settingsPath: string;
};

export type ChaptaleSettingsState = {
  /** Chaptale 应用自身设置，持久化到 settings.json。 */
  settings: ChaptaleSettings;
  paths: ChaptaleSettingsPaths;
};

export type UpdateChaptaleSettingsPayload = Static<typeof UpdateChaptaleSettingsPayloadSchema>;
