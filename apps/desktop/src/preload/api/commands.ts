import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';

export function createSlashCommandsApi(): ChaptaleDesktopApi['slashCommands'] {
  return {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.slashCommands.list)
  };
}
