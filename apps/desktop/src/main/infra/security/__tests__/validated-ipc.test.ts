import type { IpcMainInvokeEvent } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { configureTrustedRendererUrl } from '../trusted-ipc';
import { handleValidatedIpc } from '../validated-ipc';

const electronMock = vi.hoisted(() => ({
  handle: vi.fn()
}));

vi.mock('electron', () => ({
  ipcMain: {
    handle: electronMock.handle
  }
}));

type RegisteredListener = (event: IpcMainInvokeEvent, ...args: unknown[]) => Promise<unknown>;

function createEvent(url: string): IpcMainInvokeEvent {
  const mainFrame = { url };

  return {
    senderFrame: mainFrame,
    sender: { mainFrame }
  } as unknown as IpcMainInvokeEvent;
}

function getRegisteredListener(): RegisteredListener {
  const listener = electronMock.handle.mock.calls.at(-1)?.[1];

  if (typeof listener !== 'function') {
    throw new Error('IPC listener 未注册');
  }

  return listener as RegisteredListener;
}

describe('handleValidatedIpc', () => {
  const trustedUrl = 'http://127.0.0.1:5173';

  beforeEach(() => {
    electronMock.handle.mockClear();
    configureTrustedRendererUrl(trustedUrl);
  });

  it('可信 sender 且参数合法时调用业务 listener', async () => {
    const check = vi.fn(
      (value: unknown) => Array.isArray(value) && typeof value[0] === 'string' && typeof value[1] === 'number'
    );
    const validator = {
      Check(value: unknown): value is [string, number] {
        return check(value);
      }
    };
    const listener = vi.fn((_event: IpcMainInvokeEvent, name: string, count: number) => ({
      name,
      count
    }));

    handleValidatedIpc('test:valid', validator, listener);
    const event = createEvent(`${trustedUrl}/#/chat`);

    await expect(getRegisteredListener()(event, 'chapter', 3)).resolves.toEqual({
      name: 'chapter',
      count: 3
    });
    expect(check).toHaveBeenCalledWith(['chapter', 3]);
    expect(listener).toHaveBeenCalledWith(event, 'chapter', 3);
  });

  it('在参数校验前拒绝非可信 sender', async () => {
    const check = vi.fn((_value: unknown) => true);
    const validator = {
      Check(value: unknown): value is [string] {
        return check(value);
      }
    };
    const listener = vi.fn();

    handleValidatedIpc('test:untrusted', validator, listener);

    await expect(getRegisteredListener()(createEvent('https://evil.example'), 'sk-secret')).rejects.toThrow(
      '拒绝来自非可信页面的 IPC 请求'
    );
    expect(check).not.toHaveBeenCalled();
    expect(listener).not.toHaveBeenCalled();
  });

  it('参数 tuple 非法时仅暴露频道信息', async () => {
    const check = vi.fn((_value: unknown) => false);
    const validator = {
      Check(value: unknown): value is [string] {
        return check(value);
      }
    };
    const listener = vi.fn();
    const channel = 'test:invalid';
    const payload = {
      apiKey: 'sk-sensitive-key',
      path: 'C:/Users/Owner/private/config.json',
      prompt: '完整 payload 内容'
    };

    handleValidatedIpc(channel, validator, listener);

    const invocation = getRegisteredListener()(createEvent(trustedUrl), payload);
    await expect(invocation).rejects.toThrow(`IPC 参数无效：${channel}`);
    await invocation.catch((error: Error) => {
      expect(error.message).toBe(`IPC 参数无效：${channel}`);
      expect(error.message).not.toContain(payload.apiKey);
      expect(error.message).not.toContain(payload.path);
      expect(error.message).not.toContain(JSON.stringify(payload));
    });
    expect(check).toHaveBeenCalledWith([payload]);
    expect(listener).not.toHaveBeenCalled();
  });

  it('将业务 listener 抛出的非 Error 值归一化', async () => {
    const validator = {
      Check: (_value: unknown): _value is [] => true
    };
    const listener = vi.fn(() => {
      throw '业务失败';
    });

    handleValidatedIpc('test:normalize', validator, listener);

    const invocation = getRegisteredListener()(createEvent(trustedUrl));
    await expect(invocation).rejects.toBeInstanceOf(Error);
    await expect(invocation).rejects.toThrow('业务失败');
  });
});
