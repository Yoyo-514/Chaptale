import {
  IPC_CHANNELS,
  UpdateChaptaleSettingsArgsValidator,
  type SelectWorkspaceDirResult,
  type UpdateChaptaleSettingsPayload
} from '@chaptale/ipc-contract';

import type { UiShell } from '../../core/ipc-ports';
import { SettingsService } from '../../core/settings/service';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';

/**
 * 归属设置读写、目录选择与配置目录频道；IPC 层校验信任和参数结构，持久化语义交给服务。
 * 目录选择绑定请求 sender 所属窗口。
 */
export function registerSettingsIpc(settingsService: SettingsService, ui: UiShell) {
  handleTrustedIpc(IPC_CHANNELS.settings.getState, () => settingsService.getState());

  handleValidatedIpc(
    IPC_CHANNELS.settings.update,
    UpdateChaptaleSettingsArgsValidator,
    (_event, payload: UpdateChaptaleSettingsPayload) => settingsService.update(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.settings.selectWorkspaceDir, async (event): Promise<SelectWorkspaceDirResult> => {
    const workspacePath = await ui.pickDirectory(ui.resolveOwner(event), '选择 Chaptale 作品');

    if (!workspacePath) {
      return { canceled: true };
    }

    const state = await settingsService.update({ workspace: { path: workspacePath } });

    return { canceled: false, workspacePath, state };
  });

  handleTrustedIpc(IPC_CHANNELS.settings.openConfigDir, async () => {
    await settingsService.ensureSettingsFile();
    await ui.openPath(settingsService.rootDir);
  });
}
