import { ipcRenderer } from 'electron';

import type { AppPlatformResult } from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

import type { ChaptaleDesktopApi } from '../../bridge/contracts';

export function createGetPlatformApi(): ChaptaleDesktopApi['getPlatform'] {
  return () => ipcRenderer.invoke(IPC_CHANNELS.app.getPlatform) as Promise<AppPlatformResult>;
}
export function createEditCommandApi(): ChaptaleDesktopApi['editCommand'] {
  return command => ipcRenderer.invoke(IPC_CHANNELS.app.editCommand, command);
}
