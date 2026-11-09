import path from 'node:path';

import { DataDirectory } from '../core/data-directory';
import { SettingsService } from '../core/settings/service';
import { createCloudProviderAdapters } from '../features/cloud-sync/providers/registry';
import { CloudSyncService } from '../features/cloud-sync/service';
import { CloudSyncStore } from '../features/cloud-sync/store';
import { openExternalUrl } from '../infra/electron/external-link';
import { createSafeStorageCipher } from '../infra/electron/safe-storage';
import { TokenVault } from '../infra/security/token-vault';

export type AppContext = {
  settingsService: SettingsService;
  dataDirectory: DataDirectory;
  cloudSyncService: CloudSyncService;
};

export function createAppContext(): AppContext {
  const settingsService = new SettingsService();
  // 云端账户落应用配置目录：凭据经 safeStorage 加密后存盘。
  const cloudSyncService = new CloudSyncService({
    adapters: createCloudProviderAdapters(),
    store: new CloudSyncStore(
      new TokenVault(createSafeStorageCipher()),
      path.join(settingsService.rootDir, 'agent', 'cloud-sync.json')
    ),
    openExternal: openExternalUrl
  });
  return { settingsService, dataDirectory: new DataDirectory(settingsService), cloudSyncService };
}
