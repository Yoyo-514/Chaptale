import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { AppPlatformResult, ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { ipcRenderer } from 'electron';

export function createGetPlatformApi(): ChaptaleDesktopApi['getPlatform'] {
  return () => ipcRenderer.invoke(IPC_CHANNELS.app.getPlatform) as Promise<AppPlatformResult>;
}
