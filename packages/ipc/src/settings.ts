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

/**
 * 云端备份的自动节奏。
 *
 * 间隔是唯一的节奏参数：判断只看“距上次成功备份够不够这个分钟数”，
 * 所以自动备份每天最多一回是它自然的结果，不需要另设一道封顶。
 */
export type ChaptaleBackupSettings = {
  /** 自动备份开关。 */
  auto: boolean;
  /** 两次自动备份之间的最短间隔（分钟）；默认 1440 = 每日一次。 */
  intervalMinutes: number;
};

/** 当前打开的作品；没有打开作品时 path 缺省。 */
export type ChaptaleWorkspaceSettings = {
  path?: string;
};

/** 资源管理器偏好；属于“这个人想看到什么”，不随作品变。 */
export type ChaptaleExplorerSettings = {
  /** 是否在文件树里展示 `.chaptale/` 等应用内部文件。 */
  showInternalFiles: boolean;
};

export type ChaptaleSettings = {
  version: 1;
  /** 当前打开的作品。 */
  workspace: ChaptaleWorkspaceSettings;
  /** 资源管理器偏好；缺省由主进程补齐，Renderer 拿到的一定是确定值。 */
  explorer: ChaptaleExplorerSettings;
  editor?: { autoSave: boolean };
  /**
   * 云端备份的自动节奏；缺省由主进程补齐，Renderer 拿到的一定是确定值。
   *
   * 默认**开启**且每日一次：真正能跑还要已登录 + 已绑定，所以“默认开”不会自己往外传东西，
   * 而“忘了备”的代价是手稿丢失。
   */
  backup: ChaptaleBackupSettings;
  /** 界面主题；缺省由主进程补齐，Renderer 拿到的一定是确定值。 */
  theme: ChaptaleTheme;
  recentWorkspaces?: string[];
};

export type ChaptaleSettingsPaths = {
  rootDir: string;
  settingsPath: string;
  /** 当前作品目录；没打开作品时为空串。 */
  currentCwd: string;
};

export type ChaptaleSettingsState = {
  /** Chaptale 应用自身设置，持久化到 settings.json。 */
  settings: ChaptaleSettings;
  paths: ChaptaleSettingsPaths;
};

export type UpdateChaptaleSettingsPayload = Static<typeof UpdateChaptaleSettingsPayloadSchema>;

export type SelectWorkspaceDirResult = {
  canceled: boolean;
  workspacePath?: string;
  state?: ChaptaleSettingsState;
};
