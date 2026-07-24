import { ipcRenderer } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

export function createSlashCommandsApi(): ChaptaleDesktopApi['slashCommands'] {
  return {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.slashCommands.list)
  };
}
