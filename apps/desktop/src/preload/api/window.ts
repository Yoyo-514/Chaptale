import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { ChaptaleDesktopApi, WindowStateResult } from '@chaptale/ipc-contract';

export function createWindowControlApi(): ChaptaleDesktopApi['windowControl'] {
  return {
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.window.minimize) as Promise<WindowStateResult>,
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.window.toggleMaximize) as Promise<WindowStateResult>,
    close: () => ipcRenderer.invoke(IPC_CHANNELS.window.close) as Promise<void>,
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.window.isMaximized) as Promise<WindowStateResult>
  };
}
