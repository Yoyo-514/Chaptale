import { ipcMain } from 'electron';

import { isTrustedRendererUrl } from './navigation-security';

import type { IpcMainInvokeEvent } from 'electron';

let trustedRendererUrl: string | undefined;

export function configureTrustedRendererUrl(url: string) {
  trustedRendererUrl = url;
}

export function assertTrustedIpcSender(event: IpcMainInvokeEvent) {
  const frame = event.senderFrame;

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
  ipcMain.handle(channel, (event, ...args) => {
    assertTrustedIpcSender(event);
    return listener(event, ...(args as TArgs));
  });
}
