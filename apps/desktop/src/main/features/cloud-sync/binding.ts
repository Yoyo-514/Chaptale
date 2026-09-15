import type {
  CloudBindArgs,
  CloudBinding,
  CloudBindingResult,
  CloudListFoldersArgs,
  CloudListFoldersResult,
  CloudOperationResult,
  CloudProvider
} from '@chaptale/ipc-contract';
import { errorToMessage } from '@chaptale/shared';

import {
  BACKUP_FOLDER_NAME,
  BACKUP_MARKER_FILE,
  createMarker,
  parseMarker,
  serializeMarker
} from './backup/remote-layout';
import type { CloudCredential, CloudProviderAdapter } from './providers/provider-port';
import type { CloudSyncStore } from './store';
import type { CloudCredentialResult, CloudWorkspaceResult } from './types';

type BindingOptions = {
  store: CloudSyncStore;
  requireWorkspace: () => Promise<CloudWorkspaceResult>;
  requireCredential: (provider: CloudProvider) => Promise<CloudCredentialResult>;
};

/** 绑定载荷不夹带备份时间与错误；同一事实只在结果中出现一次。 */
export function toCloudBinding(binding: CloudBinding): CloudBinding {
  return {
    provider: binding.provider,
    folderId: binding.folderId,
    folderName: binding.folderName,
    boundAt: binding.boundAt
  };
}

/** 云端目录身份与本机绑定；修改入口由 CloudSyncService 持有操作锁。 */
export class CloudBindings {
  constructor(private readonly options: BindingOptions) {}

  async getBinding(): Promise<CloudBindingResult> {
    const workspace = await this.options.requireWorkspace();
    if (!workspace.ok) return workspace;
    const binding = await this.options.store.readBinding(workspace.workspace.rootPath);
    return binding
      ? {
          ok: true,
          binding: toCloudBinding(binding),
          lastBackupAt: binding.lastBackupAt ?? null,
          lastBackupError: binding.lastBackupError ?? null
        }
      : { ok: false, code: 'no-binding', message: '这部作品还没有绑定云端备份位置' };
  }

  async listFolders(args: CloudListFoldersArgs): Promise<CloudListFoldersResult> {
    const ready = await this.options.requireCredential(args.provider);
    if (!ready.ok) return ready;
    try {
      const listing = await ready.adapter.listEntries({ credential: ready.credential, parentId: args.parentId });
      return {
        ok: true,
        current: listing.current,
        parentId: listing.parentId,
        folders: listing.entries
          .filter(entry => entry.kind === 'folder')
          .map(entry => ({ id: entry.id, name: entry.name, root: false }))
      };
    } catch (error) {
      return { ok: false, code: 'network', message: errorToMessage(error) };
    }
  }

  async bind(args: CloudBindArgs): Promise<CloudBindingResult> {
    const workspace = await this.options.requireWorkspace();
    if (!workspace.ok) return workspace;
    const ready = await this.options.requireCredential(args.provider);
    if (!ready.ok) return ready;

    try {
      const target =
        args.folderId === null && !ready.adapter.topLevelIsAppScoped
          ? await ensureContainerFolder(ready.adapter, ready.credential)
          : { id: args.folderId ?? '', name: args.folderName };
      const { adapter, credential } = ready;
      const listing = await adapter.listEntries({ credential, parentId: target.id || null });
      const file = listing.entries.find(entry => entry.kind === 'file' && entry.name === BACKUP_MARKER_FILE);
      const existing = file?.id
        ? parseMarker(new TextDecoder().decode(await adapter.download({ credential, fileId: file.id })))
        : null;
      if (existing && existing.workspaceId !== workspace.workspace.id) {
        return {
          ok: false,
          code: 'failed',
          message: `这个云端目录属于另一部作品（${existing.title || '未命名'}），不能绑定`
        };
      }
      if (!existing) {
        await adapter.upload({
          credential,
          parentId: target.id || null,
          name: BACKUP_MARKER_FILE,
          bytes: new TextEncoder().encode(
            serializeMarker(createMarker({ workspaceId: workspace.workspace.id, title: workspace.workspace.title }))
          )
        });
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
        binding: toCloudBinding(binding),
        lastBackupAt: saved?.lastBackupAt ?? null,
        lastBackupError: saved?.lastBackupError ?? null
      };
    } catch (error) {
      return { ok: false, code: 'network', message: errorToMessage(error) };
    }
  }

  async unbind(): Promise<CloudOperationResult> {
    const workspace = await this.options.requireWorkspace();
    if (!workspace.ok) return workspace;
    await this.options.store.removeBinding(workspace.workspace.rootPath);
    return { ok: true };
  }
}

async function ensureContainerFolder(adapter: CloudProviderAdapter, credential: CloudCredential) {
  const listing = await adapter.listEntries({ credential, parentId: null });
  const existing = listing.entries.find(entry => entry.kind === 'folder' && entry.name === BACKUP_FOLDER_NAME);
  if (existing) return { id: existing.id ?? BACKUP_FOLDER_NAME, name: existing.name };
  const created = await adapter.createFolder({ credential, parentId: null, name: BACKUP_FOLDER_NAME });
  return { id: created.id ?? BACKUP_FOLDER_NAME, name: created.name };
}
