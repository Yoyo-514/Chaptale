import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import type {
  ChaptaleBackupSettings,
  CloudArchiveArgs,
  CloudAuthResult,
  CloudBackupListResult,
  CloudBackupProgress,
  CloudBackupResult,
  CloudBindArgs,
  CloudBinding,
  CloudBindingResult,
  CloudErrorCode,
  CloudListFoldersArgs,
  CloudListFoldersResult,
  CloudOperationResult,
  CloudProvider,
  CloudRestoreArgs,
  CloudRestoreChoice,
  CloudRestoreDiffArgs,
  CloudRestoreDiffResult,
  CloudRestorePlanResult,
  CloudRestoreResult,
  CloudRestoreSkip,
  CloudSyncState
} from '@chaptale/ipc-contract';
import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDERS } from '@chaptale/ipc-contract';

import { toWorkspaceSessionDirName } from '../../core/settings/workspace-session-directory';
import { writeBytesAtomically } from '../../infra/filesystem/atomic-bytes';
import { shouldAutoBackup } from './auto-backup';
import { collectWorkspaceContent, packWorkspace, resolveInside, unpackArchive } from './backup/archive';
import { checksumFile } from './backup/checksum';
import type { ArchiveContent } from './backup/manifest';
import {
  manifestOf,
  parseWorkspaceIdentity,
  readArchiveContent,
  readArchiveEntry,
  readArchiveManifest
} from './backup/manifest';
import {
  BACKUP_FOLDER_NAME,
  BACKUP_MARKER_FILE,
  type BackupMarker,
  archiveFileName,
  conflictCopyName,
  createMarker,
  deviceName,
  isArchiveFileName,
  parseMarker,
  sanitizeName,
  serializeMarker,
  timestamp
} from './backup/remote-layout';
import { createRestoreGuard } from './backup/restore-guard';
import { compareRestore } from './backup/restore-plan';
import type { FileIdentity } from './file-identity';
import { runAuthorizationCodeFlow } from './oauth-flow';
import type { CloudCredential, CloudProviderAdapter } from './providers/provider-port';
import type { CloudSyncStore, StoredCloudBinding } from './store';

/** 当前作品。备份的身份标记要靠 `chaptale.json` 的 id，所以三种状态分别表达。 */
export type CloudWorkspaceQuery =
  | { status: 'ready'; rootPath: string; id: string; title: string }
  | { status: 'none' }
  | { status: 'unidentified'; rootPath: string };

export type CloudSyncServiceOptions = {
  /** 已接入的服务商适配器；未接入的不出现在这里，界面只显示配置说明。 */
  adapters: CloudProviderAdapter[];
  store: CloudSyncStore;
  /** 打开系统浏览器；装配层注入 `shell.openExternal`。 */
  openExternal: (url: string) => Promise<void>;
  /** 当前作品；由装配层注入，云同步域不反向依赖作品域。 */
  resolveWorkspace: () => Promise<CloudWorkspaceQuery>;
  /**
   * 自动备份的节奏偏好；由装配层从应用设置里读。
   *
   * 注入而不是直引设置模块：测试能给出确定值，心跳的边界才能逐个钉住。
   */
  readBackupPreferences: () => Promise<ChaptaleBackupSettings>;
  /** 可重建缓存的落脚点：打包临时文件写在这里，不进作品目录也不留到下次启动。 */
  cacheRoot: string;
};

type WorkspaceFailure = { ok: false; code: CloudErrorCode; message: string };

/**
 * 云同步域的编排入口。
 *
 * 三件事：报告本构建对每个服务商的可用性、编排一次授权、编排作品级备份与恢复。
 * 网络、协议与错误映射都在适配器里；拿不到凭据的路径不进入任何网络调用。
 */
export class CloudSyncService {
  private authorizing: CloudProvider | null = null;
  private controller: AbortController | null = null;
  /** 备份与恢复都是重活：同时来两个会把临时文件与远端清单搅在一起。 */
  private busy = false;
  /** 已下载待用的归档标识；`null` 表示缓存里没有可用的归档。 */
  private pendingArchiveId: string | null = null;
  private readonly listeners = new Set<(progress: CloudBackupProgress) => void>();

  constructor(private readonly options: CloudSyncServiceOptions) {}

  /** 备份进度订阅；IPC 面注册时接上广播，与 todo/subagent 的事件形状一致。 */
  onProgress(listener: (progress: CloudBackupProgress) => void): () => void {
    this.listeners.add(listener);

    return () => this.listeners.delete(listener);
  }

  async getState(): Promise<CloudSyncState> {
    return {
      availability: CLOUD_PROVIDERS.map(provider => ({ provider, configured: this.oauthOf(provider) !== null })),
      accounts: await this.options.store.listAccounts(),
      authorizing: this.authorizing
    };
  }

  /**
   * 走完整授权：开浏览器 → 等回环回调 → 换凭据 → 落盘。
   * 授权结束（成功/取消/超时/拒绝）才 resolve，界面据此显示"等待中"。
   */
  async beginAuth(provider: CloudProvider): Promise<CloudAuthResult> {
    const adapter = this.options.adapters.find(item => item.id === provider);
    const oauth = adapter?.oauth() ?? null;
    const label = CLOUD_PROVIDER_LABELS[provider];

    if (!adapter || !oauth) {
      return { ok: false, code: 'not-configured', message: `本构建未内置 ${label} 的应用凭据，无法登录` };
    }

    if (this.authorizing) {
      return {
        ok: false,
        code: 'failed',
        message: `正在等待 ${CLOUD_PROVIDER_LABELS[this.authorizing]} 的授权，请先完成或取消`
      };
    }

    this.authorizing = provider;
    this.controller = new AbortController();

    try {
      const flow = await runAuthorizationCodeFlow({
        ...oauth,
        openExternal: this.options.openExternal,
        signal: this.controller.signal
      });

      if (!flow.ok) {
        return flow;
      }

      const { credential, profile } = await adapter.exchangeCode({
        code: flow.code,
        codeVerifier: flow.codeVerifier,
        redirectUri: flow.redirectUri,
        signal: this.controller.signal
      });
      const account = await this.options.store.saveAccount({ provider, displayName: profile.displayName, credential });

      return { ok: true, account };
    } catch (error) {
      // 换取凭据途中被取消也要如实说"已取消"，不要笼统归到网络错误。
      return this.controller.signal.aborted
        ? { ok: false, code: 'canceled', message: '已取消登录' }
        : { ok: false, code: 'network', message: `换取 ${label} 凭据失败：${describeError(error)}` };
    } finally {
      this.authorizing = null;
      this.controller = null;
    }
  }

  /** 幂等：没有挂起的授权时不做任何事。 */
  async cancelAuth(): Promise<void> {
    this.controller?.abort();
  }

  /** 只清除本机凭据，不调用服务商撤销接口；远端授权记录由作者在服务商侧管理。 */
  async signOut(provider: CloudProvider): Promise<CloudSyncState> {
    await this.options.store.removeAccount(provider);

    return this.getState();
  }

  /** 只读本机绑定，不碰网络：状态栏每次换作品都要问一次。 */
  async getBinding(): Promise<CloudBindingResult> {
    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    const binding = await this.options.store.readBinding(workspace.workspace.rootPath);

    return binding
      ? {
          ok: true,
          binding: this.toBinding(binding),
          lastBackupAt: binding.lastBackupAt ?? null,
          lastBackupError: binding.lastBackupError ?? null
        }
      : { ok: false, code: 'no-binding', message: '这部作品还没有绑定云端备份位置' };
  }

  /**
   * 只把绑定本身送出去。
   *
   * `lastBackupAt` / `lastBackupError` 在结果里有各自的位置，不再往 `binding` 里塞一份——
   * 同一个事实在载荷里出现两次，界面早晚会有一处读了旧的那个。
   */
  private toBinding(binding: StoredCloudBinding): CloudBinding {
    return {
      provider: binding.provider,
      folderId: binding.folderId,
      folderName: binding.folderName,
      boundAt: binding.boundAt
    };
  }

  async listFolders(args: CloudListFoldersArgs): Promise<CloudListFoldersResult> {
    const ready = await this.requireCredential(args.provider);

    if (!ready.ok) {
      return ready;
    }

    try {
      const listing = await ready.adapter.listEntries({
        credential: ready.credential,
        parentId: args.parentId
      });

      return {
        ok: true,
        current: listing.current,
        parentId: listing.parentId,
        // 目录选择器只要目录；文件在备份清单里另有去处。
        folders: listing.entries
          .filter(entry => entry.kind === 'folder')
          .map(entry => ({ id: entry.id, name: entry.name, root: false }))
      };
    } catch (error) {
      return { ok: false, code: 'network', message: describeError(error) };
    }
  }

  /**
   * 绑定备份位置。
   *
   * 选中最顶层且服务商的顶层不是应用专属区域时，先建一层容器目录——不然归档与身份标记
   * 会直接撒在作者网盘根上。App Folder 接入不套这层，见 `docs/m7-plan/00-cloud-sync.md` §4.3。
   */
  async bind(args: CloudBindArgs): Promise<CloudBindingResult> {
    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    const ready = await this.requireCredential(args.provider);

    if (!ready.ok) {
      return ready;
    }

    try {
      const target =
        args.folderId === null && !ready.adapter.topLevelIsAppScoped
          ? await this.ensureContainerFolder(ready.adapter, ready.credential)
          : { id: args.folderId ?? '', name: args.folderName };

      const existing = await this.readMarker(ready.adapter, ready.credential, target.id);

      if (existing && existing.workspaceId !== workspace.workspace.id) {
        return {
          ok: false,
          code: 'failed',
          message: `这个云端目录属于另一部作品（${existing.title || '未命名'}），不能绑定`
        };
      }

      if (!existing) {
        await this.writeMarker(ready.adapter, ready.credential, target.id, workspace.workspace);
      }

      const binding: CloudBinding = {
        provider: args.provider,
        folderId: target.id,
        folderName: target.name,
        boundAt: new Date().toISOString()
      };

      await this.options.store.saveBinding(workspace.workspace.rootPath, binding);

      const saved = await this.options.store.readBinding(workspace.workspace.rootPath);

      return {
        ok: true,
        binding: this.toBinding(binding),
        lastBackupAt: saved?.lastBackupAt ?? null,
        lastBackupError: saved?.lastBackupError ?? null
      };
    } catch (error) {
      return { ok: false, code: 'network', message: describeError(error) };
    }
  }

  async unbind(): Promise<CloudOperationResult> {
    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    await this.options.store.removeBinding(workspace.workspace.rootPath);

    return { ok: true };
  }

  /** 清单、绑定状态与配额一次带回：面板打开一次就要这三样，拆三个频道只是多两次往返。 */
  async listBackups(): Promise<CloudBackupListResult> {
    const target = await this.requireTarget();

    if (!target.ok) {
      return target;
    }

    try {
      const listing = await target.adapter.listEntries({
        credential: target.credential,
        parentId: target.binding.folderId || null
      });
      const archives = listing.entries
        .filter((entry): entry is typeof entry & { id: string } => entry.kind === 'file' && Boolean(entry.id))
        .filter(entry => isArchiveFileName(entry.name))
        .map(entry => ({
          id: entry.id,
          name: entry.name,
          sizeBytes: entry.size ?? 0,
          modifiedAt: entry.modifiedAt ?? null
        }))
        // 文件名以时间戳结尾，倒序就是最新在前。
        .toSorted((left, right) => (left.name < right.name ? 1 : -1));

      return {
        ok: true,
        binding: this.toBinding(target.binding),
        archives,
        quota: await this.readQuota(target),
        lastBackupError: target.binding.lastBackupError ?? null
      };
    } catch (error) {
      return { ok: false, code: 'network', message: describeError(error) };
    }
  }

  async createBackup(): Promise<CloudBackupResult> {
    const target = await this.requireTarget();

    if (!target.ok) {
      return target;
    }

    if (this.busy) {
      return { ok: false, code: 'failed', message: '已有备份或恢复正在进行' };
    }

    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    this.busy = true;

    const tempDir = path.join(this.options.cacheRoot, 'cloud-backup');
    const archivePath = path.join(tempDir, 'packing.zip');

    try {
      await mkdir(tempDir, { recursive: true });
      this.emit({ phase: 'packing', done: 0, total: 0 });

      const packed = await packWorkspace({
        rootPath: workspace.workspace.rootPath,
        targetPath: archivePath,
        onProgress: (done, total) => this.emit({ phase: 'packing', done, total })
      });

      this.emit({ phase: 'uploading' });

      const bytes = await readFile(archivePath);
      const name = archiveFileName({ title: workspace.workspace.title, deviceName: deviceName(), at: new Date() });
      const entry = await target.adapter.upload({
        credential: target.credential,
        parentId: target.binding.folderId || null,
        name,
        bytes
      });

      // 记下本机这次成功备份的时间：状态栏与面板靠它回答“要不要再备一次”。
      await this.options.store.markBackup(workspace.workspace.rootPath, new Date().toISOString());

      return {
        ok: true,
        archive: {
          id: entry.id ?? name,
          name: entry.name || name,
          sizeBytes: entry.size ?? bytes.byteLength,
          modifiedAt: entry.modifiedAt ?? null
        },
        files: packed.files,
        bytes: packed.bytes
      };
    } catch (error) {
      return { ok: false, code: 'failed', message: describeError(error) };
    } finally {
      this.busy = false;
      // 临时归档不留在本机：它只是一次上传的中转，下次备份会重新打。
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
    }
  }

  /** 本轮只有"恢复到新目录"一种模式；原地覆盖与逐文件合并是 S3。 */
  /**
   * 恢复计划：三种模式共用同一份比对结论，**不写任何文件**。
   *
   * 计划是给作者看的，也是执行时复查的依据：文件在计划的下一刻还会变，
   * 所以 `applyRestore` 重新算一遍，而不是相信界面拿回来的那份清单。
   */
  async planRestore(args: CloudArchiveArgs): Promise<CloudRestorePlanResult> {
    const target = await this.requireTarget();

    if (!target.ok) {
      return target;
    }

    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    try {
      const archivePath = await this.ensureArchive(target, args.archiveId);
      const manifest = await readArchiveManifest(archivePath);
      const comparison = compareRestore({
        archive: manifest.files,
        local: await this.readLocalSide(workspace.workspace.rootPath)
      });

      return {
        ok: true,
        plan: {
          archiveId: args.archiveId,
          identityMatches: (await parseWorkspaceIdentity(archivePath)) === workspace.workspace.id,
          entries: comparison.entries,
          emptyDirectories: manifest.directories,
          localOnly: comparison.localOnly
        }
      };
    } catch (error) {
      return { ok: false, code: 'failed', message: describeError(error) };
    }
  }

  /** 读一个冲突项的两侧正文；二进制或过大的文件不给内容，只给“没法在应用内对比”。 */
  async readRestoreDiff(args: CloudRestoreDiffArgs): Promise<CloudRestoreDiffResult> {
    const target = await this.requireTarget();

    if (!target.ok) {
      return target;
    }

    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    try {
      const archivePath = await this.ensureArchive(target, args.archiveId);
      const archived = await readArchiveEntry(archivePath, args.relativePath);

      if (!archived) {
        return { ok: false, code: 'failed', message: '归档里没有这个文件，重新算一次恢复计划' };
      }

      const localPath = resolveInside(workspace.workspace.rootPath, args.relativePath);
      const local = await readFile(localPath).catch(() => null);

      // 本地那份已经不在了：这时“冲突”这个前提本身就不成立，让界面重新算计划，
      // 而不是拿一个空正文去当“本地版本”给作者看。
      if (!local) {
        return { ok: false, code: 'failed', message: '本地这个文件已经不在了，重新算一次恢复计划' };
      }

      const archiveText = decodeText(archived);
      const localText = decodeText(local);

      if (archiveText === null || localText === null) {
        return {
          ok: true,
          text: false,
          reason: 'binary',
          archiveBytes: archived.byteLength,
          localBytes: local.byteLength
        };
      }

      if (archiveText.length > MAX_DIFF_CHARS || localText.length > MAX_DIFF_CHARS) {
        return {
          ok: true,
          text: false,
          reason: 'too-large',
          archiveBytes: archived.byteLength,
          localBytes: local.byteLength
        };
      }

      return { ok: true, text: true, archiveText, localText };
    } catch (error) {
      return { ok: false, code: 'failed', message: describeError(error) };
    }
  }

  /**
   * 执行恢复。
   *
   * `overwrite` 与 `merge` 的硬门槛按顺序是：身份能自证 → 快照拿得到 → 才动文件。
   * 任何一步不过就直接返回，作品目录保持原样。
   */
  async applyRestore(args: CloudRestoreArgs): Promise<CloudRestoreResult> {
    const target = await this.requireTarget();

    if (!target.ok) {
      return target;
    }

    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    if (this.busy) {
      return { ok: false, code: 'failed', message: '已有备份或恢复正在进行' };
    }

    this.busy = true;

    try {
      const archivePath = await this.ensureArchive(target, args.archiveId);

      if (args.mode === 'new') {
        const targetPath = await this.uniqueRestorePath(workspace.workspace.rootPath, workspace.workspace.title);
        const unpacked = await unpackArchive({ archivePath, targetPath });

        // 新目录不在当前作品里，没有要重载的 tab，所以不填写入清单。
        return {
          ok: true,
          targetPath,
          mode: 'new',
          written: unpacked.files,
          writtenPaths: [],
          snapshotId: null,
          skipped: []
        };
      }

      const identity = await parseWorkspaceIdentity(archivePath);

      if (identity !== workspace.workspace.id) {
        return {
          ok: false,
          code: 'failed',
          message: '这份归档不能自证是当前作品（归档里没有 chaptale.json 或身份对不上），原地恢复会毁掉作品目录'
        };
      }

      const snapshotId = await this.createGuard(workspace.workspace.rootPath);
      const content = await readArchiveContent(archivePath);
      const writtenPaths: string[] = [];
      const skipped: CloudRestoreSkip[] = [];

      if (args.mode === 'overwrite') {
        // **只写归档里有的文件**：本地独有的一个都不删——
        // 否则“恢复到旧版本”会顺手抹掉快照之外新写的章节。
        for (const file of content.files) {
          await writeBytesAtomically(resolveInside(workspace.workspace.rootPath, file.relativePath), file.data);
          writtenPaths.push(file.relativePath);
        }
      } else {
        const merged = await this.mergeIntoWorkspace(content, workspace.workspace.rootPath, args.choices ?? {});

        writtenPaths.push(...merged.writtenPaths);
        skipped.push(...merged.skipped);
      }

      // 空目录：文件路径建不出它们，得单独建。
      for (const directory of content.directories) {
        await mkdir(resolveInside(workspace.workspace.rootPath, directory), { recursive: true });
      }

      return {
        ok: true,
        targetPath: workspace.workspace.rootPath,
        mode: args.mode,
        written: writtenPaths.length,
        writtenPaths,
        snapshotId,
        skipped
      };
    } catch (error) {
      return { ok: false, code: 'failed', message: describeError(error) };
    } finally {
      this.busy = false;
      await this.clearArchive();
    }
  }

  /** 放弃这次恢复：删掉已下载的待用归档，作品目录一个字节都没动。 */
  async cancelRestore(): Promise<CloudOperationResult> {
    await this.clearArchive();

    return { ok: true };
  }

  /**
   * 合并：逐文件挑选，**绝不自动决定**。
   *
   * 只有“归档里有、本地没有”才不问自取（那是新增）；两边都有但不同的，作者没给决议就不写、
   * 也不覆盖，逐条列进回执。这条不变量在**执行侧**，不在界面侧——界面算错一次不该等于毁稿一次。
   */
  private async mergeIntoWorkspace(
    content: ArchiveContent,
    rootPath: string,
    choices: Record<string, CloudRestoreChoice>
  ): Promise<{ writtenPaths: string[]; skipped: CloudRestoreSkip[] }> {
    const comparison = compareRestore({
      archive: manifestOf(content).files,
      local: await this.readLocalSide(rootPath)
    });
    const data = new Map(content.files.map(file => [file.relativePath, file.data]));
    const at = new Date();
    const writtenPaths: string[] = [];
    const skipped: CloudRestoreSkip[] = [];

    for (const entry of comparison.entries) {
      if (entry.verdict === 'identical') {
        continue;
      }

      if (entry.verdict === 'conflict') {
        const choice = choices[entry.relativePath];

        if (!choice) {
          skipped.push({ relativePath: entry.relativePath, reason: '你没对这项做决定，本地保持不动' });
          continue;
        }

        if (choice === 'local') {
          continue;
        }

        // 两个都留：本地那份改名留档，原路径让给归档版本。
        if (choice === 'both') {
          await rename(
            resolveInside(rootPath, entry.relativePath),
            await this.conflictCopyPath(rootPath, entry.relativePath, at)
          );
        }
      }

      const bytes = data.get(entry.relativePath);

      if (!bytes) {
        throw new Error(`归档内容与清单不一致：${entry.relativePath}`);
      }

      await writeBytesAtomically(resolveInside(rootPath, entry.relativePath), bytes);
      writtenPaths.push(entry.relativePath);
    }

    return { writtenPaths, skipped };
  }

  /** 冲突副本落在原位旁边，名字用与索引侧一致的词汇（`冲突副本`）；撞名就加序号，不覆盖任何东西。 */
  private async conflictCopyPath(rootPath: string, relativePath: string, at: Date): Promise<string> {
    const copy = conflictCopyName(relativePath, at);

    return this.uniquePath(resolveInside(rootPath, copy));
  }

  /**
   * 本地侧：整棵作品目录的路径、字节数与内容指纹。判“一致”靠指纹，不靠时间戳。
   *
   * 与归档共用同一套遍历（`collectWorkspaceContent`）：排除规则只该有一份，
   * 否则“归档里有什么”与“本地拿什么去比”会慢慢对不上。
   */
  private async readLocalSide(rootPath: string): Promise<FileIdentity[]> {
    const content = await collectWorkspaceContent(rootPath);
    const files: FileIdentity[] = [];

    for (const file of content.files) {
      files.push({
        relativePath: file.relativePath,
        bytes: file.size,
        digest: await checksumFile(file.absolutePath)
      });
    }

    return files;
  }

  /** 还原前快照。拿不到就不动手：它是覆盖与合并唯一的兜底（见 `restore-guard.ts`）。 */
  private async createGuard(rootPath: string): Promise<string> {
    const guard = await createRestoreGuard({
      workspaceRoot: rootPath,
      // 按作品分开：恢复 A 作品不该挤掉 B 作品的快照。
      guardRoot: path.join(this.options.cacheRoot, toWorkspaceSessionDirName(rootPath), 'restore-guard'),
      at: new Date()
    });

    return guard.id;
  }

  /**
   * 待用归档：同一次恢复向导里只下载一次。
   *
   * 计划要下载整包才能比对，执行还要用同一份；缓存落在 `cacheRoot/cloud-restore/`，
   * **不进作品目录**。换一个归档就替换，结束或取消就删。
   */
  private async ensureArchive(
    target: { adapter: CloudProviderAdapter; credential: CloudCredential },
    archiveId: string
  ): Promise<string> {
    const dir = path.join(this.options.cacheRoot, 'cloud-restore');
    const archivePath = path.join(dir, 'pending.zip');

    if (this.pendingArchiveId === archiveId && (await pathExists(archivePath))) {
      return archivePath;
    }

    const bytes = await target.adapter.download({ credential: target.credential, fileId: archiveId });

    await mkdir(dir, { recursive: true });
    await writeFile(archivePath, bytes);
    this.pendingArchiveId = archiveId;

    return archivePath;
  }

  /** 待用归档不留到下一次：它可能和整个作品一样大。 */
  private async clearArchive(): Promise<void> {
    this.pendingArchiveId = null;

    await rm(path.join(this.options.cacheRoot, 'cloud-restore'), { recursive: true, force: true }).catch(
      () => undefined
    );
  }

  /**
   * 自动备份的一次心跳。
   *
   * “该不该备”在这里答（走一个纯函数），而“备得成备不成”交给 `createBackup` 自己的门槛：
   * 登录、绑定、作品打开、是否正忙这几件事只该有一处规则，心跳不另立一套。
   */
  async autoBackupTick(now: Date = new Date()): Promise<void> {
    const preferences = await this.options.readBackupPreferences();

    if (!preferences.auto) return;

    const workspace = await this.requireWorkspace();

    // 作品没打开就不动：自动备份不替作者去开作品，也不在没有落脚点时往外传东西。
    if (!workspace.ok) return;

    const rootPath = workspace.workspace.rootPath;
    const binding = await this.options.store.readBinding(rootPath);

    if (!binding) return;

    if (
      !shouldAutoBackup({
        now,
        lastBackupAt: binding.lastBackupAt ?? null,
        intervalMinutes: preferences.intervalMinutes,
        busy: this.busy
      })
    ) {
      return;
    }

    const result = await this.createBackup();

    // 只记真正的失败：没登录、没绑定这类“现在不适合”不是故障，下一拍还会照常判断。
    if (!result.ok && (result.code === 'failed' || result.code === 'network')) {
      await this.options.store.markBackupFailure(rootPath, { at: now.toISOString(), message: result.message });
    }
  }

  /**
   * 删除云端归档。
   *
   * **只由作者的显式确认触发**：应用没有自动删除备份的路径，包括自动备份自己也不删旧档。
   */
  async removeBackup(args: CloudArchiveArgs): Promise<CloudOperationResult> {
    const target = await this.requireTarget();

    if (!target.ok) {
      return target;
    }

    try {
      await target.adapter.remove({ credential: target.credential, entryId: args.archiveId });

      return { ok: true };
    } catch (error) {
      return { ok: false, code: 'network', message: describeError(error) };
    }
  }

  private emit(progress: CloudBackupProgress) {
    for (const listener of this.listeners) {
      listener(progress);
    }
  }

  private async requireWorkspace(): Promise<
    { ok: true; workspace: CloudWorkspaceQuery & { status: 'ready' } } | WorkspaceFailure
  > {
    const query = await this.options.resolveWorkspace();

    if (query.status === 'none') {
      return { ok: false, code: 'no-workspace', message: '请先打开作品' };
    }

    if (query.status === 'unidentified') {
      return {
        ok: false,
        code: 'failed',
        message: '这部作品缺少 chaptale.json，云端备份需要它来核对身份；请先在作品目录里补上它'
      };
    }

    return { ok: true, workspace: query };
  }

  private async requireCredential(
    provider: CloudProvider
  ): Promise<
    | { ok: true; adapter: CloudProviderAdapter; credential: CloudCredential }
    | { ok: false; code: CloudErrorCode; message: string }
  > {
    const label = CLOUD_PROVIDER_LABELS[provider];
    const adapter = this.options.adapters.find(item => item.id === provider);

    if (!adapter?.oauth()) {
      return { ok: false, code: 'not-configured', message: `本构建未内置 ${label} 的应用凭据` };
    }

    const credential = await this.options.store.readCredential(provider);

    if (!credential) {
      return { ok: false, code: 'not-signed-in', message: `请先登录 ${label}` };
    }

    return { ok: true, adapter, credential };
  }

  /** 备份相关动作的共同前置：作品已打开、已绑定、适配器与凭据齐备。 */
  private async requireTarget(): Promise<
    | { ok: true; adapter: CloudProviderAdapter; credential: CloudCredential; binding: StoredCloudBinding }
    | WorkspaceFailure
  > {
    const workspace = await this.requireWorkspace();

    if (!workspace.ok) {
      return workspace;
    }

    const binding = await this.options.store.readBinding(workspace.workspace.rootPath);

    if (!binding) {
      return { ok: false, code: 'no-binding', message: '这部作品还没有绑定云端备份位置' };
    }

    const ready = await this.requireCredential(binding.provider);

    if (!ready.ok) {
      return ready;
    }

    return { ok: true, adapter: ready.adapter, credential: ready.credential, binding };
  }

  private async ensureContainerFolder(adapter: CloudProviderAdapter, credential: CloudCredential) {
    const listing = await adapter.listEntries({ credential, parentId: null });
    const existing = listing.entries.find(entry => entry.kind === 'folder' && entry.name === BACKUP_FOLDER_NAME);

    if (existing) {
      return { id: existing.id ?? BACKUP_FOLDER_NAME, name: existing.name };
    }

    const created = await adapter.createFolder({ credential, parentId: null, name: BACKUP_FOLDER_NAME });

    return { id: created.id ?? BACKUP_FOLDER_NAME, name: created.name };
  }

  private async readMarker(
    adapter: CloudProviderAdapter,
    credential: CloudCredential,
    folderId: string
  ): Promise<BackupMarker | null> {
    const listing = await adapter.listEntries({ credential, parentId: folderId || null });
    const file = listing.entries.find(entry => entry.kind === 'file' && entry.name === BACKUP_MARKER_FILE);

    if (!file?.id) {
      return null;
    }

    return parseMarker(new TextDecoder().decode(await adapter.download({ credential, fileId: file.id })));
  }

  private async writeMarker(
    adapter: CloudProviderAdapter,
    credential: CloudCredential,
    folderId: string,
    workspace: { id: string; title: string }
  ) {
    const marker = createMarker({ workspaceId: workspace.id, title: workspace.title });

    await adapter.upload({
      credential,
      parentId: folderId || null,
      name: BACKUP_MARKER_FILE,
      bytes: new TextEncoder().encode(serializeMarker(marker))
    });
  }

  /** 配额是装饰不是操作本身：读不到就显示"未提供"，不让整张清单跟着失败。 */
  private async readQuota(target: { adapter: CloudProviderAdapter; credential: CloudCredential }) {
    try {
      return await target.adapter.quota({ credential: target.credential });
    } catch {
      return null;
    }
  }

  /** 「回到新目录」模式的落点：与当前作品并排的 `<作品名>-恢复-<时间戳>/`，不碰现有目录。 */
  private async uniqueRestorePath(workspaceRoot: string, title: string): Promise<string> {
    const parent = path.dirname(workspaceRoot);

    return this.uniquePath(path.join(parent, `${sanitizeName(title)}-恢复-${timestamp(new Date())}`));
  }

  /** 撞名就加序号：恢复的产物不能覆盖作者已有的同名文件。 */
  private async uniquePath(candidate: string): Promise<string> {
    const extension = path.extname(candidate);
    const base = candidate.slice(0, candidate.length - extension.length);
    let current = candidate;

    for (let index = 2; await pathExists(current); index += 1) {
      current = `${base}-${index}${extension}`;
    }

    return current;
  }

  private oauthOf(provider: CloudProvider) {
    return this.options.adapters.find(item => item.id === provider)?.oauth() ?? null;
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);

    return true;
  } catch {
    return false;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 应用内对比的正文上限：超过它就不把内容送过 IPC，只让作者选用哪一份。 */
const MAX_DIFF_CHARS = 512 * 1024;

/** 文本判定沿用仓库既有口径（`managed-text.ts`）：有 NUL 字节或过不了严格 UTF-8 就不是文本。 */
function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}
