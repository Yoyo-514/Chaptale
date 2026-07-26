import type { IpcMainInvokeEvent } from 'electron';

export type IpcBroadcaster = {
  /** 向所有存活窗口广播；单窗口发送失败不得抛出，不得连带触发方失败。 */
  broadcast(channel: string, payload?: unknown): void;
};

export type IpcOwnerResolver = {
  /** 把 IPC 事件 sender 解析为对话框 owner；找不到时返回 undefined。 */
  resolveOwner(event: IpcMainInvokeEvent): unknown;
};

export type NativeDialogPort = {
  pickDirectory(owner: unknown, title: string): Promise<string | undefined>;
  pickSavePath(options: {
    title: string;
    defaultPath?: string;
    filters: Array<{ name: string; extensions: string[] }>;
  }): Promise<string | undefined>;
};

export type ShellPort = {
  /** 在系统文件管理器中打开路径；失败时抛异常。 */
  openPath(target: string): Promise<void>;
};

export type UiShell = IpcBroadcaster & IpcOwnerResolver & NativeDialogPort & ShellPort;
