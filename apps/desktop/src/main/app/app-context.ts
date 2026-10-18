import path from 'node:path';

import { SettingsService } from '../core/settings/service';
import { createAutoBackupScheduler } from '../features/cloud-sync/auto-backup';
import { createCloudProviderAdapters } from '../features/cloud-sync/providers/registry';
import { CloudSyncService } from '../features/cloud-sync/service';
import { CloudSyncStore } from '../features/cloud-sync/store';
import { RecoveryStore } from '../features/workspace/recovery';
import { WorkspaceService } from '../features/workspace/service';
import { WorkspaceWatcher } from '../features/workspace/watcher';
import { openExternalUrl } from '../infra/electron/external-link';
import { createSafeStorageCipher } from '../infra/electron/safe-storage';
import { TokenVault } from '../infra/security/token-vault';

export type AppContext = {
  settingsService: SettingsService;
  workspaceService: WorkspaceService;
  cloudSyncService: CloudSyncService;
  /** 自动备份心跳；由 `bootstrap` 在应用就绪后启动，退出时停下。 */
  autoBackupScheduler: { start: () => void; stop: () => void };
};

export function createAppContext(): AppContext {
  const settingsService = new SettingsService();
  const workspaceService = new WorkspaceService(
    settingsService,
    {},
    new WorkspaceWatcher(),
    new RecoveryStore(path.join(settingsService.rootDir, 'cache'))
  );

  // 云同步账户与绑定落应用配置目录：凭据经 safeStorage 加密后存盘，作品目录里不放任何 token。
  const cloudSyncService = new CloudSyncService({
    adapters: createCloudProviderAdapters(),
    store: new CloudSyncStore(
      new TokenVault(createSafeStorageCipher()),
      path.join(settingsService.rootDir, 'agent', 'cloud-sync.json')
    ),
    openExternal: openExternalUrl,
    // 备份的身份标记靠作品清单的 id：没清单就无法核对，如实报第三种状态，不凑一个 id 出来。
    resolveWorkspace: async () => {
      const state = await workspaceService.getState();

      if (!state.rootPath) {
        return { status: 'none' as const };
      }

      const layout = await workspaceService.getLayout(state.rootPath);

      if (!layout.ok || !layout.layout.manifest) {
        return { status: 'unidentified' as const, rootPath: state.rootPath };
      }

      return {
        status: 'ready' as const,
        rootPath: state.rootPath,
        id: layout.layout.manifest.id,
        title: layout.layout.manifest.title
      };
    },
    cacheRoot: path.join(settingsService.rootDir, 'cache'),
    readBackupPreferences: async () => (await settingsService.readSettings()).backup
  });

  // 自动备份的心跳：只负责“按分钟敲一下”，“该不该备”由服务里的纯判断决定。
  const autoBackupScheduler = createAutoBackupScheduler({
    tick: now => cloudSyncService.autoBackupTick(now)
  });

  return { settingsService, workspaceService, cloudSyncService, autoBackupScheduler };
}
