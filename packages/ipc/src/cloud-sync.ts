import type { Static } from 'typebox';

import type { CloudListFoldersArgsSchema, CloudProviderArgsSchema, CloudProviderSchema } from './schemas/cloud-sync';

export type CloudProvider = Static<typeof CloudProviderSchema>;

/**
 * 服务商取值表。
 *
 * 与主题取值同一形状：写成 Record 把这里和 schema 双向钉死，schema 增了取值而这里缺分支、
 * 或这里多写一个 schema 没有的值，两种漂移都在编译期失败。
 */
const CLOUD_PROVIDER_VALUES: Record<CloudProvider, true> = { dropbox: true, onedrive: true, nutstore: true };

/** 界面按固定顺序呈现服务商，不依赖对象键顺序。 */
export const CLOUD_PROVIDERS = Object.keys(CLOUD_PROVIDER_VALUES) as CloudProvider[];

/** 界面与主进程错误文案共用同一份名称，避免两侧各写一套后漂移。 */
export const CLOUD_PROVIDER_LABELS: Record<CloudProvider, string> = {
  dropbox: 'Dropbox',
  onedrive: 'OneDrive',
  nutstore: '坚果云'
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

/** 作品在云端的备份位置。 */
export type CloudBinding = {
  provider: CloudProvider;
  /** 远端目录标识（Dropbox 为路径）。 */
  folderId: string;
  folderName: string;
  /** 绑定时间（ISO 8601）。 */
  boundAt: string;
};

/** 绑定目标：`folderId` 为 null 表示作者选的是最顶层目录。 */
export type CloudBindArgs = {
  provider: CloudProvider;
  folderId: string | null;
  folderName: string;
};

/**
 * 自动备份最近一次失败（本机）。
 *
 * 自动备份是静默的，所以失败必须留下来看得见——否则作者只会以为“一直在正常备”，
 * 直到真的需要那份归档。成功一次就清掉。
 */
export type CloudBackupFailure = {
  at: string;
  message: string;
};

/** 绑定结果。`lastBackupAt` 是**本机**上次成功备份的时间：状态栏与面板靠它回答“要不要再备一次”。 */
export type CloudBindingResult =
  | {
      ok: true;
      binding: CloudBinding;
      /** 从未在本机备份过就是 null。其他设备备份不会更新它，它也不假装知道。 */
      lastBackupAt: string | null;
      lastBackupError: CloudBackupFailure | null;
    }
  | { ok: false; code: CloudErrorCode; message: string };

/** 云端归档。展示名就是远端文件名：时间戳与设备名都在文件名里。 */
export type CloudBackupArchive = {
  id: string;
  name: string;
  sizeBytes: number;
  /** 服务商侧修改时间（ISO 8601）；取不到就不填，不用本地时间凑。 */
  modifiedAt: string | null;
};

export type CloudQuota = {
  usedBytes: number;
  totalBytes: number;
};

/**
 * 备份清单。绑定状态与配额一起返回：面板打开一次就要这三样，分成三个频道只是多两次往返。
 * `quota` 为 null 表示服务商没提供或读不到（如坚果云 WebDAV），界面显示“未提供”而不是编一个数。
 */
export type CloudBackupListResult =
  | {
      ok: true;
      binding: CloudBinding;
      archives: CloudBackupArchive[];
      quota: CloudQuota | null;
      lastBackupError: CloudBackupFailure | null;
    }
  | { ok: false; code: CloudErrorCode; message: string };

export type CloudBackupResult =
  | { ok: true; archive: CloudBackupArchive; files: number; bytes: number }
  | { ok: false; code: CloudErrorCode; message: string };

/** 恢复模式：新增到新目录 / 原地覆盖 / 逐文件合并。 */
export type CloudRestoreMode = 'new' | 'overwrite' | 'merge';

/** 合并模式下逐项挑选的决议；「两个都留」由 `both` 表达，本地那份改名留档。 */
export type CloudRestoreChoice = 'archive' | 'local' | 'both';

/**
 * 归档与本地逐文件的比对结论。
 *
 * `add` 与 `identical` 不需要作者做决定，只有 `conflict` 要。本地独有的文件不进这个清单：
 * 三种模式都不动它们，逐条列出来只会淹没真正需要看的那几项。
 */
export type CloudRestoreVerdict = 'add' | 'identical' | 'conflict';

export type CloudRestorePlanEntry = {
  /** 相对作品目录的路径，正斜杠。 */
  relativePath: string;
  verdict: CloudRestoreVerdict;
  archiveBytes: number;
  /** 本地那份的字节数；`add` 时为 null。 */
  localBytes: number | null;
  /**
   * 应用数据路径（`.chaptale/**`）。
   *
   * 界面据它分组（否则版本级、运行级的应用文件会把真正要看的几章埋掉），
   * **不改变**四种动作的判定：这些文件同样逐项由作者定，不会因为“是应用数据”被自动决定。
   */
  system: boolean;
};

export type CloudRestorePlan = {
  archiveId: string;
  /** 归档带的作品身份与本地是否一致。不一致时覆盖与合并必须被挡住——那是另一部作品的历史。 */
  identityMatches: boolean;
  entries: CloudRestorePlanEntry[];
  /** 归档里的空目录。比对表只讲文件，但恢复要把它们建出来。 */
  emptyDirectories: string[];
  /** 本地有、归档里没有的文件数：三种模式都保留它们。 */
  localOnly: number;
};

export type CloudRestorePlanResult =
  | { ok: true; plan: CloudRestorePlan }
  | { ok: false; code: CloudErrorCode; message: string };

/**
 * 单个冲突项的正文。
 *
 * 非文本文件只回“二进制不同”与两侧字节数：把它们塞进文本比对只会得到乱码，
 * 而且真正的决定（用哪一份）不需要看到字节。
 */
export type CloudRestoreDiffResult =
  | { ok: true; text: true; archiveText: string; localText: string }
  | {
      ok: true;
      text: false;
      /** `binary`：不是文本；`too-large`：是文本但超出应用内对比的上限。 */
      reason: 'binary' | 'too-large';
      archiveBytes: number;
      localBytes: number;
    }
  | { ok: false; code: CloudErrorCode; message: string };

/** 没被执行的文件与原因：合并时缺决议、内容在计划之后又变了等等。 */
export type CloudRestoreSkip = { relativePath: string; reason: string };

export type CloudRestoreArgs = {
  archiveId: string;
  mode: CloudRestoreMode;
  /**
   * 合并模式：相对路径 → 决议。
   *
   * **可以只给一部分**：没给决议的冲突项一律不写、也不覆盖，回执里逐条列出来。
   * 这正是“作者没点头就不动文件”的落实处。
   */
  choices?: Record<string, CloudRestoreChoice>;
};

export type CloudRestoreResult =
  | {
      ok: true;
      /** `new` 是新目录；`overwrite` / `merge` 就是作品目录本身。 */
      targetPath: string;
      mode: CloudRestoreMode;
      /** 本次真正落到磁盘的文件数（新增 + 覆盖 + 留档的归档版）。 */
      written: number;
      /** 写入的路径（相对作品目录）；渲染侧按它决定重载哪些 tab。 */
      writtenPaths: string[];
      /** 还原前快照标识；`new` 模式为 null——它本来就不动现有内容。 */
      snapshotId: string | null;
      skipped: CloudRestoreSkip[];
    }
  | { ok: false; code: CloudErrorCode; message: string };

export type CloudArchiveArgs = { archiveId: string };

/** 读单个冲突项的正文：归档标识 + 归档内相对路径。 */
export type CloudRestoreDiffArgs = { archiveId: string; relativePath: string };

/**
 * 备份进度。
 *
 * 打包阶段能给“第几个文件 / 共几个”；上传阶段给不了字节进度——Dropbox 的简单上传
 * 不回报进度，要字节级进度就得走分片上传，那是本轮明确不做的事。
 */
export type CloudBackupProgress = { phase: 'packing'; done: number; total: number } | { phase: 'uploading' };

export type CloudOperationResult = { ok: true } | { ok: false; code: CloudErrorCode; message: string };

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
 * 坚果云 WebDAV 没有专属区域的概念，最顶层就是作者自己的网盘根。
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
