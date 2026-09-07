import { dialog, type BrowserWindow } from 'electron';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';

const approved = new WeakSet<BrowserWindow>();
const pending = new WeakMap<BrowserWindow, ReturnType<typeof setTimeout>>();

/** 所有原生关闭入口先交给 Renderer 的保存保护，确认后只放行一次关闭。 */
export function guardWindowClose(window: BrowserWindow) {
  window.on('close', event => {
    if (approved.delete(window) || window.webContents.isDestroyed()) return;
    event.preventDefault();
    if (pending.has(window)) return;
    const timer = setTimeout(async () => {
      pending.delete(window);
      if (window.isDestroyed()) return;
      const choice = await dialog.showMessageBox(window, {
        type: 'warning',
        title: '窗口未响应',
        message: '编辑器没有响应关闭请求。仍要退出？',
        detail: '尚未保存的修改可能丢失。',
        buttons: ['取消', '仍然退出'],
        defaultId: 0,
        cancelId: 0
      });
      if (choice.response === 1 && !window.isDestroyed()) window.destroy();
    }, 10_000);
    pending.set(window, timer);
    window.webContents.send(IPC_CHANNELS.window.closeRequested);
  });
  window.once('closed', () => {
    clearTimeout(pending.get(window));
    pending.delete(window);
  });
}

export function completeWindowClose(window: BrowserWindow, close: boolean) {
  clearTimeout(pending.get(window));
  pending.delete(window);
  if (close) {
    approved.add(window);
    window.close();
  }
}
