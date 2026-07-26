import type { IpcRendererEvent } from 'electron';
import { ipcRenderer } from 'electron';

type RuntimeValidator<T> = { Check(value: unknown): value is T };

/**
 * 订阅 Main 推送事件并校验 payload：非法事件丢弃并记录，绝不让脏数据进入 UI 状态。
 * 返回取消订阅函数。
 */
export function onValidatedEvent<T>(
  channel: string,
  validator: RuntimeValidator<T>,
  listener: (payload: T) => void
): () => void {
  const handler = (_event: IpcRendererEvent, payload: unknown) => {
    if (!validator.Check(payload)) {
      console.error(`[ipc] 丢弃 ${channel} 的非法事件 payload`);
      return;
    }

    listener(payload);
  };

  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}
