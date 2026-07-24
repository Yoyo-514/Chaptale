import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi, UpdatePromptSettingsPayload } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

export function createPromptSettingsApi(): ChaptaleDesktopApi['promptSettings'] {
  return {
    getState: () => ipcRenderer.invoke(IPC_CHANNELS.promptSettings.getState),
    update: (payload: UpdatePromptSettingsPayload) => ipcRenderer.invoke(IPC_CHANNELS.promptSettings.update, payload)
  };
}
