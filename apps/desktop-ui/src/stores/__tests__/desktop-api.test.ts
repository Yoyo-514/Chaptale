import { afterEach, describe, expect, it } from 'vitest';

import { getDesktopApi, toErrorMessage } from '../utils/desktop-api';

describe('desktop-api helpers', () => {
  afterEach(() => {
    delete window.chaptaleDesktop;
  });

  it('strips Electron IPC remote method prefix', () => {
    expect(toErrorMessage("Error invoking remote method 'models:list': Error: 403 blocked")).toBe('403 blocked');
  });

  it('formats unknown errors', () => {
    expect(toErrorMessage('plain error')).toBe('plain error');
  });

  it('returns the desktop bridge when running in the desktop shell', () => {
    window.chaptaleDesktop = { marker: true } as unknown as typeof window.chaptaleDesktop;

    expect(getDesktopApi()).toEqual({ marker: true });
  });

  it('throws a user-readable error outside the desktop shell', () => {
    expect(() => getDesktopApi()).toThrow('当前界面需要在 Chaptale 桌面端中运行');
  });
});
