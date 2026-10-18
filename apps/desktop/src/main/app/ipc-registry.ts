import { EditCommandValidator, IPC_CHANNELS, type AppPlatformResult, type EditCommand } from '@chaptale/ipc-contract';

import { registerCloudSyncIpc } from '../features/cloud-sync/ipc';
import { registerSettingsIpc } from '../features/settings/ipc';
import { registerWorkspaceIpc } from '../features/workspace/ipc';
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
export function registerApplicationIpc(context: AppContext): void {
  const ui = new ElectronUiShell();
  registerWorkspaceIpc(context.workspaceService, ui);
  registerCloudSyncIpc(context.cloudSyncService, ui);
  registerSettingsIpc(context.settingsService, ui);
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
}
