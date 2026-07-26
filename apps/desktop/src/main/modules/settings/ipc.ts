import {
  IPC_CHANNELS,
  UpdateChaptaleSettingsArgsValidator,
  UpdatePiWebAccessSettingsArgsValidator,
  type SelectWorkspaceDirResult,
  type UpdateChaptaleSettingsPayload,
  type UpdatePiWebAccessSettingsPayload
} from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { UiShell } from '../ipc-ports';
import { SettingsService } from './service';

/**
 * 归属设置读写、目录选择与配置目录频道；IPC 层校验信任和参数结构，持久化语义交给服务。
 * 目录选择绑定请求 sender 所属窗口，含存储设置的更新成功后触发失效回调。
 */
export function registerSettingsIpc(settingsService: SettingsService, ui: UiShell, onStorageChanged?: () => void) {
  handleTrustedIpc(IPC_CHANNELS.settings.getState, () => settingsService.getState());

  handleValidatedIpc(
    IPC_CHANNELS.settings.update,
    UpdateChaptaleSettingsArgsValidator,
    async (_event, payload: UpdateChaptaleSettingsPayload) => {
      const state = await settingsService.update(payload);

      if (payload.storage) {
        onStorageChanged?.();
      }

      return state;
    }
  );

  handleValidatedIpc(
    IPC_CHANNELS.settings.updateWebAccess,
    UpdatePiWebAccessSettingsArgsValidator,
    (_event, payload: UpdatePiWebAccessSettingsPayload) => settingsService.updateWebAccess(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.settings.selectWorkspaceDir, async (event): Promise<SelectWorkspaceDirResult> => {
    const workspacePath = await ui.pickDirectory(ui.resolveOwner(event), '选择 Chaptale 工作区');

    if (!workspacePath) {
      return { canceled: true };
    }

    const state = await settingsService.update({ storage: { mode: 'workspace', workspacePath } });
    onStorageChanged?.();

    return { canceled: false, workspacePath, state };
  });

  handleTrustedIpc(IPC_CHANNELS.settings.openConfigDir, async () => {
    await settingsService.ensureBaseDirs();
    await ui.openPath(settingsService.rootDir);
  });
}
