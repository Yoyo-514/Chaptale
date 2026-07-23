import type { IpcMainInvokeEvent } from 'electron';

import { handleTrustedIpc } from './trusted-ipc';

export function handleValidatedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  validator: { Check(value: unknown): value is TArgs },
  listener: (event: IpcMainInvokeEvent, ...args: TArgs) => TResult | Promise<TResult>
): void {
  handleTrustedIpc(channel, (event, ...args) => {
    // 将实参数组作为 tuple 整体验证，确保多参数与原始值参数频道都受同一契约约束。
    if (!validator.Check(args)) {
      throw new Error(`IPC 参数无效：${channel}`);
    }

    return listener(event, ...args);
  });
}
