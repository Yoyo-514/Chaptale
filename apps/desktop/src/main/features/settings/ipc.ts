import { IPC_CHANNELS } from '../../../bridge/channels';
import { UpdateChaptaleSettingsArgsValidator } from '../../../bridge/schemas/settings';
import type { UpdateChaptaleSettingsPayload } from '../../../bridge/settings';
import type { UiShell } from '../../core/ipc-ports';
import { SettingsService } from '../../core/settings/service';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';

/** 归属设置读写与配置目录频道；IPC 层校验信任和参数结构，持久化语义交给服务。 */
export function registerSettingsIpc(settingsService: SettingsService, ui: UiShell) {
  handleTrustedIpc(IPC_CHANNELS.settings.getState, () => settingsService.getState());

  handleValidatedIpc(
    IPC_CHANNELS.settings.update,
    UpdateChaptaleSettingsArgsValidator,
    (_event, payload: UpdateChaptaleSettingsPayload) => settingsService.update(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.settings.openConfigDir, async () => {
    await settingsService.ensureSettingsFile();
    await ui.openPath(settingsService.rootDir);
  });
}
