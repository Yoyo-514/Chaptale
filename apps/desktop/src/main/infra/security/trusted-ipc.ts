import { errorToMessage } from '@chaptale/shared';
import { ipcMain } from 'electron';

import { isTrustedRendererUrl } from './navigation-security';

import type { IpcMainInvokeEvent } from 'electron';

let trustedRendererUrl: string | undefined;

export function configureTrustedRendererUrl(url: string) {
  trustedRendererUrl = url;
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;

  // 同时核对 rendererFrame、mainFrame 与 URL，阻断子 frame 或已跳转页面越过主窗口信任边界。
  if (
    !trustedRendererUrl ||
    !frame ||
    frame !== event.sender.mainFrame ||
    !isTrustedRendererUrl(frame.url, trustedRendererUrl)
  ) {
    throw new Error('拒绝来自非可信页面的 IPC 请求');
  }
}

export function handleTrustedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult
) {
  ipcMain.handle(channel, async (event, ...args) => {
    assertTrustedIpcSender(event);

    try {
      return await listener(event, ...(args as TArgs));
    } catch (error) {
      // 统一 IPC 错误面：非 Error 抛出物归一为 Error，renderer 侧不会收到 "[object Object]"。
      throw error instanceof Error ? error : new Error(errorToMessage(error));
    }
  });
}
