import { IPC_CHANNELS, type UpdateChaptaleSettingsPayload } from '@chaptale/ipc-contract';
import { BrowserWindow, dialog, ipcMain, shell, type OpenDialogOptions } from 'electron';
import { SettingsService } from '../services/settings.service';

export function registerSettingsIpc(settingsService: SettingsService, onStorageChanged?: () => void) {
  ipcMain.handle(IPC_CHANNELS.settings.getState, () => settingsService.getState());

  ipcMain.handle(IPC_CHANNELS.settings.update, async (_event, payload: UpdateChaptaleSettingsPayload) => {
    const state = await settingsService.update(payload);

    if (payload.storage || payload.webAccess) {
      onStorageChanged?.();
    }

    return state;
  });

  ipcMain.handle(IPC_CHANNELS.settings.selectWorkspaceDir, async event => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options: OpenDialogOptions = {
      title: '选择 Chaptale 工作区',
      properties: ['openDirectory', 'createDirectory']
    };
    const result = owner ? await dialog.showOpenDialog(owner, options) : await dialog.showOpenDialog(options);

    if (result.canceled || !result.filePaths[0]) {
      return { canceled: true };
    }

    const state = await settingsService.update({
      storage: {
        mode: 'workspace',
        workspacePath: result.filePaths[0]
      }
    });

    onStorageChanged?.();

    return {
      canceled: false,
      workspacePath: result.filePaths[0],
      state
    };
  });

  ipcMain.handle(IPC_CHANNELS.settings.openConfigDir, async () => {
    await settingsService.ensureBaseDirs();
    const errorMessage = await shell.openPath(settingsService.rootDir);

    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
}
