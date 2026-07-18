import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { ChaptaleDesktopApi, UpdatePromptSettingsPayload } from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';

export function createPromptSettingsApi(): ChaptaleDesktopApi['promptSettings'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.promptSettings.getState),
    update: (payload: UpdatePromptSettingsPayload) => ipcRenderer.invoke(IPC_CHANNELS.promptSettings.update, payload)
  };
}
