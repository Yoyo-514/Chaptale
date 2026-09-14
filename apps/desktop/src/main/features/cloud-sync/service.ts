import { mkdir, readFile, rm } from 'node:fs/promises';
import path from 'node:path';

import type {
  ChaptaleBackupSettings,
  CloudArchiveArgs,
  CloudArchiveListArgs,
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
  CloudRemovalResult,
  CloudRestoreArgs,
  CloudRestoreDiffArgs,
  CloudRestoreDiffResult,
  CloudRestorePlanResult,
  CloudRestoreResult,
  CloudSyncState
} from '@chaptale/ipc-contract';
import { CLOUD_PROVIDER_LABELS, CLOUD_PROVIDERS } from '@chaptale/ipc-contract';

import { shouldAutoBackup } from './auto-backup';
import { packWorkspace } from './backup/archive';
import { RestoreArchiveCache } from './backup/archive-cache';
import {
  BACKUP_FOLDER_NAME,
  BACKUP_MARKER_FILE,
  type BackupMarker,
  archiveFileName,
  createMarker,
  deviceName,
  isArchiveFileName,
  parseMarker,
  serializeMarker
} from './backup/remote-layout';
import { WorkspaceRestorer } from './backup/restore-workspace';
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
type CloudTarget = {
  ok: true;
  adapter: CloudProviderAdapter;
  credential: CloudCredential;
  binding: StoredCloudBinding;
  workspace: CloudWorkspaceQuery & { status: 'ready' };
};

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
  private readonly archiveCache: RestoreArchiveCache;
  private readonly restorer: WorkspaceRestorer;
  private readonly listeners = new Set<(progress: CloudBackupProgress) => void>();

  constructor(private readonly options: CloudSyncServiceOptions) {
    this.archiveCache = new RestoreArchiveCache(options.cacheRoot);
    this.restorer = new WorkspaceRestorer(options.cacheRoot);
  }

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
    if (this.busy) throw new Error('请等待备份或恢复结束后再退出账户');
    await this.options.store.removeAccount(provider);
    await this.archiveCache.clear();

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
   * 会直接撒在作者网盘根上。App Folder 接入不套这层：服务商给的顶层本身就是应用专属区域。
   */
  async bind(args: CloudBindArgs): Promise<CloudBindingResult> {
    if (this.busy) return { ok: false, code: 'failed', message: '请等待备份或恢复结束后再更改绑定' };
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
    if (this.busy) return { ok: false, code: 'failed', message: '请等待备份或恢复结束后再解除绑定' };
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
    if (this.busy) return { ok: false, code: 'failed', message: '已有备份或恢复正在进行' };
    // 必须在第一个 await 前占用；否则并发请求会共用 packing.zip。
    this.busy = true;
    const tempDir = path.join(this.options.cacheRoot, 'cloud-backup');
    const archivePath = path.join(tempDir, 'packing.zip');

    try {
      const target = await this.requireTarget();
      if (!target.ok) return target;
      const { workspace } = target;
      await mkdir(tempDir, { recursive: true });
      this.emit({ phase: 'packing', done: 0, total: 0 });

      const packed = await packWorkspace({
        rootPath: workspace.rootPath,
        targetPath: archivePath,
        onProgress: (done, total) => this.emit({ phase: 'packing', done, total })
      });

      this.emit({ phase: 'uploading' });

      const bytes = await readFile(archivePath);
      const name = archiveFileName({ title: workspace.title, deviceName: deviceName(), at: new Date() });
      const entry = await target.adapter.upload({
        credential: target.credential,
        parentId: target.binding.folderId || null,
        name,
        bytes
      });

      // 记下本机这次成功备份的时间：状态栏与面板靠它回答“要不要再备一次”。
      await this.options.store.markBackup(workspace.rootPath, new Date().toISOString());

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
      // 临时归档不留在本机：它只是一次上传的中转，下次备份会重新打。
      await rm(tempDir, { recursive: true, force: true }).catch(() => undefined);
      this.busy = false;
    }
  }

  planRestore(args: CloudArchiveArgs): Promise<CloudRestorePlanResult> {
    return this.withArchive(args.archiveId, (archive, target) =>
      this.restorer.plan(archive, target.workspace, args.archiveId)
    );
  }

  readRestoreDiff(args: CloudRestoreDiffArgs): Promise<CloudRestoreDiffResult> {
    return this.withArchive(args.archiveId, (archive, target) =>
      this.restorer.diff(archive, target.workspace.rootPath, args.relativePath)
    );
  }

  applyRestore(args: CloudRestoreArgs): Promise<CloudRestoreResult> {
    return this.withArchive(
      args.archiveId,
      (archive, target) => this.restorer.apply(archive, target.workspace, args),
      true
    );
  }

  async cancelRestore(): Promise<CloudOperationResult> {
    if (this.busy) return { ok: false, code: 'failed', message: '正在读取或恢复归档，请等待操作结束' };
    this.busy = true;
    try {
      await this.archiveCache.clear();
      return { ok: true };
    } finally {
      this.busy = false;
    }
  }

  /** 计划、差异和执行共用锁，下载期间取消或换归档不能破坏另一个操作的输入。 */
  private async withArchive<T>(
    archiveId: string,
    action: (archive: string, target: CloudTarget) => Promise<T>,
    clearAfter = false
  ): Promise<T | WorkspaceFailure> {
    if (this.busy) return { ok: false, code: 'failed', message: '已有备份或恢复正在进行' };
    this.busy = true;
    try {
      const target = await this.requireTarget();
      if (!target.ok) return target;
      const archive = await this.archiveCache.ensure(
        { ...target, rootPath: target.workspace.rootPath, folderId: target.binding.folderId },
        archiveId
      );
      const current = await this.requireWorkspace();
      if (
        !current.ok ||
        current.workspace.rootPath !== target.workspace.rootPath ||
        current.workspace.id !== target.workspace.id
      ) {
        throw new Error('作品已切换，请重新打开恢复向导');
      }
      return await action(archive, target);
    } catch (error) {
      return { ok: false, code: 'failed', message: describeError(error) };
    } finally {
      if (clearAfter) await this.archiveCache.clear();
      this.busy = false;
    }
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
  async removeBackups(args: CloudArchiveListArgs): Promise<CloudRemovalResult> {
    const target = await this.requireTarget();

    if (!target.ok) {
      return target;
    }

    const removed: string[] = [];
    const failed: { archiveId: string; message: string }[] = [];

    for (const archiveId of args.archiveIds) {
      try {
        await target.adapter.remove({ credential: target.credential, entryId: archiveId });
        removed.push(archiveId);
      } catch (error) {
        failed.push({ archiveId, message: describeError(error) });
      }
    }

    // 逐条回结论：一份没删掉不该让其余的回滚，也不该被混进一句“删除失败”——那样只能重试全部。
    return { ok: true, removed, failed };
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
  private async requireTarget(): Promise<CloudTarget | WorkspaceFailure> {
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

    return { ok: true, adapter: ready.adapter, credential: ready.credential, binding, workspace: workspace.workspace };
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

  private oauthOf(provider: CloudProvider) {
    return this.options.adapters.find(item => item.id === provider)?.oauth() ?? null;
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
