import {
  IPC_CHANNELS,
  type SelectWorkspaceDirResult,
  type UpdateChaptaleSettingsPayload,
  type UpdatePiWebAccessSettingsPayload
} from '@chaptale/ipc-contract';
import { BrowserWindow } from 'electron';
import { pickDirectory } from '../infra/dialog-gateway';
import { openPathOrThrow } from '../infra/shell-gateway';
import { handleTrustedIpc } from '../security/trusted-ipc';
import { SettingsService } from '../services/settings.service';

export function registerSettingsIpc(settingsService: SettingsService, onStorageChanged?: () => void) {
  handleTrustedIpc(IPC_CHANNELS.settings.getState, () => settingsService.getState());

  handleTrustedIpc(IPC_CHANNELS.settings.update, async (_event, payload: UpdateChaptaleSettingsPayload) => {
    const state = await settingsService.update(payload);

    if (payload.storage) {
      onStorageChanged?.();
    }

    return state;
  });

  handleTrustedIpc(IPC_CHANNELS.settings.updateWebAccess, (_event, payload: UpdatePiWebAccessSettingsPayload) =>
    settingsService.updateWebAccess(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.settings.selectWorkspaceDir, async (event): Promise<SelectWorkspaceDirResult> => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const workspacePath = await pickDirectory(owner, '选择 Chaptale 工作区');

    if (!workspacePath) {
      return { canceled: true };
    }

    const state = await settingsService.update({ storage: { mode: 'workspace', workspacePath } });
    onStorageChanged?.();

    return { canceled: false, workspacePath, state };
  });

  handleTrustedIpc(IPC_CHANNELS.settings.openConfigDir, async () => {
    await settingsService.ensureBaseDirs();
    await openPathOrThrow(settingsService.rootDir);
  });
}
