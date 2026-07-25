import type { IpcMainInvokeEvent } from 'electron';

import { handleTrustedIpc } from './trusted-ipc';

type RuntimeValidator<T> = { Check(value: unknown): value is T };

type ValidatedIpcListener<TArgs extends unknown[], TResult> = (
  event: IpcMainInvokeEvent,
  ...args: TArgs
) => TResult | Promise<TResult>;

export function handleValidatedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  argsValidator: RuntimeValidator<TArgs>,
  listener: ValidatedIpcListener<TArgs, TResult>
): void;
export function handleValidatedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  argsValidator: RuntimeValidator<TArgs>,
  resultValidator: RuntimeValidator<TResult> | undefined,
  listener: ValidatedIpcListener<TArgs, TResult>
): void;
export function handleValidatedIpc<TArgs extends unknown[], TResult>(
  channel: string,
  argsValidator: RuntimeValidator<TArgs>,
  resultValidatorOrListener: RuntimeValidator<TResult> | ValidatedIpcListener<TArgs, TResult> | undefined,
  maybeListener?: ValidatedIpcListener<TArgs, TResult>
): void {
  const resultValidator = typeof resultValidatorOrListener === 'function' ? undefined : resultValidatorOrListener;
  const listener = typeof resultValidatorOrListener === 'function' ? resultValidatorOrListener : maybeListener;

  if (!listener) {
    throw new Error(`IPC listener 未注册：${channel}`);
  }

  handleTrustedIpc(channel, async (event, ...args) => {
    // 将实参数组作为 tuple 整体验证，确保多参数与原始值参数频道都受同一契约约束。
    if (!argsValidator.Check(args)) {
      throw new Error(`IPC 参数无效：${channel}`);
    }

    const result = await listener(event, ...args);

    // 响应校验只覆盖 invoke 返回值边界；业务异常保持原样交给 trusted IPC 统一处理。
    if (resultValidator && !resultValidator.Check(result)) {
      throw new Error(`IPC 响应无效：${channel}`);
    }

    return result;
  });
}
