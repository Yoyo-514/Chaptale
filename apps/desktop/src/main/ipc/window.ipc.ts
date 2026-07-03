import { BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron';
import { IPC_CHANNELS, type WindowStateResult } from '@chaptale/ipc-contract';

function getWindowFromEvent(event: IpcMainInvokeEvent) {
  const window = BrowserWindow.fromWebContents(event.sender);

  if (!window) {
    throw new Error('无法找到当前窗口');
  }

  return window;
}

function getWindowState(window: BrowserWindow): WindowStateResult {
  return {
    isMaximized: window.isMaximized()
  };
}

export function registerWindowIpc() {
  ipcMain.handle(IPC_CHANNELS.window.minimize, event => {
    const window = getWindowFromEvent(event);
    window.minimize();
    return getWindowState(window);
  });

  ipcMain.handle(IPC_CHANNELS.window.toggleMaximize, event => {
    const window = getWindowFromEvent(event);

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }

    return getWindowState(window);
  });

  ipcMain.handle(IPC_CHANNELS.window.close, event => {
    getWindowFromEvent(event).close();
  });

  ipcMain.handle(IPC_CHANNELS.window.isMaximized, event => getWindowState(getWindowFromEvent(event)));
}
