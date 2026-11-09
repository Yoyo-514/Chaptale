import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../../bridge/channels';
import type { ChaptaleDesktopApi } from '../../bridge/contracts';

export function createDataDirectoryApi(): ChaptaleDesktopApi['dataDirectory'] {
  return {
    status: () => ipcRenderer.invoke(IPC_CHANNELS.dataDirectory.status),
    select: () => ipcRenderer.invoke(IPC_CHANNELS.dataDirectory.select),
    choose: path => ipcRenderer.invoke(IPC_CHANNELS.dataDirectory.choose, path)
  };
}
