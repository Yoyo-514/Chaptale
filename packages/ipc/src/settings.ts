import type { Static } from 'typebox';

import type {
  ChaptaleThemeSchema,
  UpdateChaptaleSettingsPayloadSchema,
  UpdateWebToolsSettingsPayloadSchema,
  WebToolsProviderSchema
} from './schemas/settings';

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

/** 当前打开的作品；没有打开作品时 path 缺省，此时既没有会话目录也不能聊天。 */
export type ChaptaleWorkspaceSettings = {
  path?: string;
};

/** 资源管理器偏好；属于“这个人想看到什么”，不随作品变。 */
export type ChaptaleExplorerSettings = {
  /** 是否在文件树里展示 `.chaptale/` 等应用内部文件。 */
  showInternalFiles: boolean;
};

export type WebToolsProvider = Static<typeof WebToolsProviderSchema>;

/** 聊天联网能力设置快照；更新 payload 允许只提交部分字段。 */
export type WebToolsSettings = {
  search: {
    /** 聊天输入框的联网开关；关闭后 web_search 报错提示，fetch/get 不受影响。 */
    enabled: boolean;
    provider: WebToolsProvider;
  };
  keys: {
    braveApiKey?: string;
    tavilyApiKey?: string;
    exaApiKey?: string;
  };
  fetch: {
    timeoutSeconds: number;
    maxBytes: number;
  };
  ssrf: {
    allowRanges: string[];
  };
};

export type ChaptaleSettings = {
  version: 1;
  /** 当前打开的作品；作者没打开作品时说话没有落脚点，聊天因此不可用。 */
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
  onboarding?: { completedVersion: number };
  /** 界面主题；缺省由主进程补齐，Renderer 拿到的一定是确定值。 */
  theme: ChaptaleTheme;
  /**
   * 按作品记忆的最近会话（作品路径 → 会话 id）。
   * 落盘字段；lastSessionId 为当前作品的合成视图。
   */
  lastSessions?: Record<string, string>;
  /** 当前作品的最近会话（合成值，不落盘）；不存在或已删除时由 Renderer 回退。 */
  lastSessionId?: string;
  recentWorkspaces?: string[];
};

export type ChaptaleSettingsPaths = {
  rootDir: string;
  agentDir: string;
  settingsPath: string;
  modelsPath: string;
  webToolsConfigPath: string;
  sessionsRootDir: string;
  effectiveSessionDir: string;
  /** Renderer 绑定会话时使用的权威 cwd；避免前端自行推导 workspace 安全边界。 */
  currentCwd: string;
};

export type ChaptaleSettingsState = {
  /** Chaptale 应用自身设置，持久化到 settings.json。 */
  settings: ChaptaleSettings;
  /** 联网能力设置，持久化到 web-tools.json。 */
  webTools: WebToolsSettings;
  paths: ChaptaleSettingsPaths;
};

export type UpdateWebToolsSettingsPayload = Static<typeof UpdateWebToolsSettingsPayloadSchema>;

/** `lastSessionId` 传 null 表示清除已记忆的会话。 */
export type UpdateChaptaleSettingsPayload = Static<typeof UpdateChaptaleSettingsPayloadSchema>;

export type SelectWorkspaceDirResult = {
  canceled: boolean;
  workspacePath?: string;
  state?: ChaptaleSettingsState;
};
