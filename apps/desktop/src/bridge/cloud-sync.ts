import type { Static } from 'typebox';

import type { WorkPackageSummary } from '@chaptale/creation/contracts';

import type {
  CloudBackupWorkArgsSchema,
  CloudBackupFileArgsSchema,
  CloudProviderArgsSchema,
  CloudProviderSchema
} from './schemas/cloud-sync';

export type CloudProvider = Static<typeof CloudProviderSchema>;

/**
 * 服务商取值表。
 *
 * 与主题取值同一形状：写成 Record 把这里和 schema 双向钉死，schema 增了取值而这里缺分支、
 * 或这里多写一个 schema 没有的值，两种漂移都在编译期失败。
 */
const CLOUD_PROVIDER_VALUES: Record<CloudProvider, true> = { dropbox: true, onedrive: true };

/** 界面按固定顺序呈现服务商，不依赖对象键顺序。 */
export const CLOUD_PROVIDERS = Object.keys(CLOUD_PROVIDER_VALUES) as CloudProvider[];

/** 界面与主进程错误文案共用同一份名称，避免两侧各写一套后漂移。 */
export const CLOUD_PROVIDER_LABELS: Record<CloudProvider, string> = {
  dropbox: 'Dropbox',
  onedrive: 'OneDrive'
};

/** 落盘账户与手改过的配置都要在用之前挡掉，与 `isChaptaleTheme` 同理。 */
export function isCloudProvider(value: unknown): value is CloudProvider {
  return typeof value === 'string' && Object.hasOwn(CLOUD_PROVIDER_VALUES, value);
}

/**
 * 本构建对某个服务商的可用性。
 *
 * `configured` 为 false 表示构建里没有该服务商的 clientId：界面只显示配置说明，
 * **不提供登录入口**——不做看起来能登录、点了才失败的占位。
 */
export type CloudProviderAvailability = {
  provider: CloudProvider;
  configured: boolean;
};

/** 已授权账号。不含任何 token 字段：凭据只在 Main 侧停留，过桥的只有展示信息。 */
export type CloudAccount = {
  provider: CloudProvider;
  /** 服务商侧账号标识（邮箱或名称），仅用于界面显示。 */
  displayName: string;
  /** 授权完成时间（ISO 8601）。 */
  connectedAt: string;
};

export type CloudSyncState = {
  availability: CloudProviderAvailability[];
  accounts: CloudAccount[];
  /** 正在进行的授权流程；没有则为 null。界面据此禁用重复入口。 */
  authorizing: CloudProvider | null;
};

/**
 * 云端操作的统一错误面。
 *
 * 界面只对少数几种分支（未配置 / 未登录 / 没有作品 / 未绑定），其余一律按文案呈现。
 */
export type CloudErrorCode =
  | 'not-configured'
  | 'not-signed-in'
  | 'no-workspace'
  | 'no-binding'
  | 'network'
  | 'canceled'
  | 'failed';

/**
 * 授权结局。
 *
 * 取消、超时、用户拒绝都是**正常结局而非异常**：它们不是错误路径，界面要能分别给出可理解的文案。
 */
export type CloudAuthResult =
  | { ok: true; account: CloudAccount }
  | { ok: false; code: CloudAuthErrorCode; message: string };

export type CloudAuthErrorCode = 'not-configured' | 'canceled' | 'timeout' | 'denied' | 'network' | 'failed';

/** 云端应用目录顶层的一份作品包。name 用于列表显示；下载和删除使用原始 id。 */
export type CloudBackup = {
  id: string;
  name: string;
  modifiedAt?: string;
  size?: number;
  summary?: WorkPackageSummary;
};

export type CloudBackupWorkArgs = Static<typeof CloudBackupWorkArgsSchema>;
export type CloudBackupFileArgs = Static<typeof CloudBackupFileArgsSchema>;
export type CloudProviderArgs = Static<typeof CloudProviderArgsSchema>;

export type CloudFailure = { ok: false; code: CloudErrorCode; message: string };
export type CloudBackupTarget = CloudBackupWorkArgs['target'];
export type CloudBackupProgress = { provider: CloudProvider; current: number; total: number };
export type CloudUploadBackupResult = { ok: true; name: string } | CloudFailure;
export type CloudBackupWorkResult =
  | { ok: true; uploads: { provider: CloudProvider; result: CloudUploadBackupResult }[] }
  | CloudFailure;
export type CloudListBackupsResult = { ok: true; backups: CloudBackup[] } | CloudFailure;
export type CloudDeleteBackupResult = { ok: true } | CloudFailure;
/** path 是下载到本机临时目录的作品包，交给作品包导入流程。 */
export type CloudDownloadBackupResult = { ok: true; path: string } | CloudFailure;
