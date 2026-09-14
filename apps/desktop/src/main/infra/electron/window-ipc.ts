import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import {
  IPC_CHANNELS,
  WindowCompleteCloseArgsValidator,
  WindowZoomArgsValidator,
  type WindowStateResult,
  type WindowZoomCommand
} from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../security/trusted-ipc';
import { handleValidatedIpc } from '../security/validated-ipc';
import { completeWindowClose } from './window-close';
import { nextWindowZoom } from './window-zoom';

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

/** 归属窗口控制与状态查询频道；通过可信 sender 定位其 BrowserWindow，避免操作其他窗口。 */
export function registerWindowIpc() {
  handleValidatedIpc(IPC_CHANNELS.window.zoom, WindowZoomArgsValidator, (event, command: WindowZoomCommand) => {
    const contents = getWindowFromEvent(event).webContents;
    const factor = nextWindowZoom(contents.getZoomFactor(), command);
    contents.setZoomFactor(factor);
    return factor;
  });
  handleTrustedIpc(IPC_CHANNELS.window.minimize, event => {
    const window = getWindowFromEvent(event);
    window.minimize();
    return getWindowState(window);
  });

  handleTrustedIpc(IPC_CHANNELS.window.toggleMaximize, event => {
    const window = getWindowFromEvent(event);

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }

    return getWindowState(window);
  });

  handleTrustedIpc(IPC_CHANNELS.window.close, event => {
    getWindowFromEvent(event).close();
  });
  handleValidatedIpc(IPC_CHANNELS.window.completeClose, WindowCompleteCloseArgsValidator, (event, close: boolean) => {
    completeWindowClose(getWindowFromEvent(event), close);
  });

  handleTrustedIpc(IPC_CHANNELS.window.isMaximized, event => getWindowState(getWindowFromEvent(event)));
}
