import { ipcRenderer } from 'electron';

import { IPC_CHANNELS } from '../../bridge/channels';
import type { ChaptaleDesktopApi } from '../../bridge/contracts';
import type { WindowStateResult } from '../../bridge/window';

export function createWindowControlApi(): ChaptaleDesktopApi['windowControl'] {
  return {
    zoom: command => ipcRenderer.invoke(IPC_CHANNELS.window.zoom, command) as Promise<number>,
    minimize: () => ipcRenderer.invoke(IPC_CHANNELS.window.minimize) as Promise<WindowStateResult>,
    toggleMaximize: () => ipcRenderer.invoke(IPC_CHANNELS.window.toggleMaximize) as Promise<WindowStateResult>,
    close: () => ipcRenderer.invoke(IPC_CHANNELS.window.close) as Promise<void>,
    completeClose: close => ipcRenderer.invoke(IPC_CHANNELS.window.completeClose, close) as Promise<void>,
    onCloseRequested: listener => {
      const handler = () => listener();
      ipcRenderer.on(IPC_CHANNELS.window.closeRequested, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.window.closeRequested, handler);
    },
    isMaximized: () => ipcRenderer.invoke(IPC_CHANNELS.window.isMaximized) as Promise<WindowStateResult>
  };
}
