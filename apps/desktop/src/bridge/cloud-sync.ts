import type { Static } from 'typebox';

import type { CloudListFoldersArgsSchema, CloudProviderArgsSchema, CloudProviderSchema } from './schemas/cloud-sync';

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

/**
 * 云端目录。
 *
 * `root` 为真表示已经是**服务商返回的最顶层**（不能再往上），此时 `id` 必为 null。
 * 最顶层的含义随服务商而变：Dropbox / OneDrive 的 App Folder 接入下，最顶层就是本应用的专属区域；
 * 没有专属区域的服务商（如自建 WebDAV），最顶层就是作者自己的网盘根。
 */
export type CloudRemoteFolder = {
  /** 服务商侧标识；最顶层为 null，与 `root` 一致。 */
  id: string | null;
  name: string;
  root: boolean;
};

export type CloudListFoldersArgs = Static<typeof CloudListFoldersArgsSchema>;

/** 只针对某个服务商的动作（授权 / 登出）的参数。 */
export type CloudProviderArgs = Static<typeof CloudProviderArgsSchema>;

export type CloudListFoldersResult =
  | {
      ok: true;
      /** 当前所在目录；界面据此渲染面包屑，并据 `current.root` 决定要不要显示“上一级”。 */
      current: CloudRemoteFolder;
      /** 上一级标识；null 表示上一级就是最顶层。当前已在最顶层时此值无意义。 */
      parentId: string | null;
      folders: CloudRemoteFolder[];
    }
  | { ok: false; code: CloudErrorCode; message: string };
