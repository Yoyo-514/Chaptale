import { BrowserWindow, type IpcMainInvokeEvent } from 'electron';

import type { NativeDialogPort, UiShell } from '../../core/ipc-ports';
import { pickDirectory, pickSavePath } from './dialog';
import { openPathOrThrow } from './shell';

export class ElectronUiShell implements UiShell {
  broadcast(channel: string, payload?: unknown): void {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDestroyed()) {
        continue;
      }

      try {
        window.webContents.send(channel, payload);
      } catch {
        // isDestroyed 检查与 send 之间存在窗口销毁竞态；推送失败不得连带触发方失败。
      }
    }
  }

  resolveOwner(event: IpcMainInvokeEvent): unknown {
    return BrowserWindow.fromWebContents(event.sender);
  }

  pickDirectory(owner: unknown, title: string): Promise<string | undefined> {
    return pickDirectory(owner as BrowserWindow | null | undefined, title);
  }

  pickSavePath(options: Parameters<NativeDialogPort['pickSavePath']>[0]): Promise<string | undefined> {
    return pickSavePath(options);
  }

  openPath(target: string): Promise<void> {
    return openPathOrThrow(target);
  }
}
