import { hostname } from 'node:os';

import type { CreationClient } from '@chaptale/creation/contracts';

import { EditCommandValidator, type AppPlatformResult, type EditCommand } from '../../bridge/app';
import { IPC_CHANNELS } from '../../bridge/channels';
import type { ScheduledBackupEvent } from '../../bridge/scheduled-backup';
import { registerScheduledBackupIpc } from '../features/backup/ipc';
import { ScheduledWorkBackups } from '../features/backup/scheduled';
import { CloudBackups } from '../features/cloud-sync/backups';
import { registerCloudSyncIpc } from '../features/cloud-sync/ipc';
import { registerDataDirectoryIpc } from '../features/settings/data-directory-ipc';
import { registerSettingsIpc } from '../features/settings/ipc';
import { ElectronUiShell } from '../infra/electron/ui-shell';
import { registerWindowIpc } from '../infra/electron/window-ipc';
import { handleTrustedIpc } from '../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../infra/security/validated-ipc';
import type { AppContext } from './app-context';

/**
 * Renderer → Main 请求频道的唯一装配入口。
 *
 * 所有模块共享同一个 AppContext 实例并只在应用启动时注册一次，避免服务状态分裂或频道重复注册。
 */
export function registerApplicationIpc(context: AppContext, creation: CreationClient): ScheduledWorkBackups {
  const ui = new ElectronUiShell();
  const device = async () => ({ name: hostname(), installId: await context.settingsService.installId() });
  const emit = (event: ScheduledBackupEvent) => ui.broadcast(IPC_CHANNELS.scheduledBackup.event, event);
  const scheduled = new ScheduledWorkBackups({
    creation,
    settings: context.settingsService,
    dataDirectory: () => context.dataDirectory.resolve(),
    cloud: context.cloudSyncService,
    device,
    onChange: () => emit({ kind: 'changed' }),
    onFailure: failure => emit({ kind: 'failed', ...failure })
  });
  registerScheduledBackupIpc(scheduled, context.settingsService, ui);
  registerCloudSyncIpc(
    context.cloudSyncService,
    new CloudBackups(
      context.cloudSyncService,
      (workId, path) => creation.request('exportWorkPackage', { workId, path }),
      path => creation.request('inspectWorkPackage', { path }),
      device
    )
  );
  registerSettingsIpc(context.settingsService, ui);
  registerDataDirectoryIpc(context.dataDirectory, ui);
  handleValidatedIpc(IPC_CHANNELS.app.editCommand, EditCommandValidator, (event, command: EditCommand) => {
    if (!event.sender.isDestroyed()) event.sender[command]();
  });
  handleTrustedIpc(
    IPC_CHANNELS.app.getPlatform,
    () =>
      ({
        platform: process.platform,
        versions: Object.fromEntries(
          Object.entries(process.versions).filter((entry): entry is [string, string] => entry[1] !== undefined)
        )
      }) satisfies AppPlatformResult
  );
  registerWindowIpc();
  return scheduled;
}
