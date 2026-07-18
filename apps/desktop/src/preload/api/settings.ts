import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type {
  ChaptaleDesktopApi,
  UpdateChaptaleSettingsPayload,
  UpdatePiWebAccessSettingsPayload
} from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';

export function createSettingsApi(): ChaptaleDesktopApi['settings'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.settings.getState),
    update: (payload: UpdateChaptaleSettingsPayload) => ipcRenderer.invoke(IPC_CHANNELS.settings.update, payload),
    updateWebAccess: (payload: UpdatePiWebAccessSettingsPayload) =>
      ipcRenderer.invoke(IPC_CHANNELS.settings.updateWebAccess, payload),
    selectWorkspaceDir: () => ipcRenderer.invoke(IPC_CHANNELS.settings.selectWorkspaceDir),
    openConfigDir: () => ipcRenderer.invoke(IPC_CHANNELS.settings.openConfigDir) as Promise<void>
  };
}
