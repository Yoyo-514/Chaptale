import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { AppPlatformResult, ChaptaleDesktopApi } from '@chaptale/ipc-contract';

export function createGetPlatformApi(): ChaptaleDesktopApi['getPlatform'] {
  return () => ipcRenderer.invoke(IPC_CHANNELS.app.getPlatform) as Promise<AppPlatformResult>;
}
