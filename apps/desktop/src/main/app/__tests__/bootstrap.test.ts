import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = await vi.hoisted(async () => {
  const { EventEmitter } = await import('node:events');
  const windows: Array<{
    loadURL: ReturnType<typeof vi.fn>;
    setIcon: ReturnType<typeof vi.fn>;
    webContents: {
      on: ReturnType<typeof vi.fn>;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
      setZoomMode: ReturnType<typeof vi.fn>;
    };
  }> = [];
  const appListeners = new Map<string, () => void>();

  const BrowserWindow = vi.fn(function BrowserWindow() {
    const window = Object.assign(new EventEmitter(), {
      loadURL: vi.fn(),
      setIcon: vi.fn(),
      webContents: {
        on: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        setZoomMode: vi.fn()
      }
    });
    windows.push(window);
    return window;
  });

  return {
    appListeners,
    windows,
    app: {
      on: vi.fn((event: string, listener: () => void) => {
        appListeners.set(event, listener);
      }),
      quit: vi.fn(),
      setAppUserModelId: vi.fn(),
      whenReady: vi.fn(() => Promise.resolve())
    },
    BrowserWindow: Object.assign(BrowserWindow, {
      getAllWindows: vi.fn(() => windows)
    }),
    Menu: { setApplicationMenu: vi.fn() },
    shell: { openExternal: vi.fn() }
  };
});

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.BrowserWindow,
  Menu: electronMock.Menu,
  shell: electronMock.shell
}));

vi.mock('../app-context', () => ({
  createAppContext: vi.fn(() => ({
    settingsService: { rootDir: process.cwd(), readSettings: vi.fn(async () => ({ theme: 'dark' })) },
    autoBackupScheduler: { start: vi.fn(), stop: vi.fn() }
  }))
}));

vi.mock('../ipc-registry', () => ({ registerApplicationIpc: vi.fn() }));
vi.mock('../../infra/security/trusted-ipc', () => ({
  configureTrustedRendererUrl: vi.fn(),
  handleTrustedIpc: vi.fn()
}));

describe('bootstrapDesktopApp', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'production');
    electronMock.windows.length = 0;
    electronMock.appListeners.clear();
    electronMock.BrowserWindow.mockClear();
    electronMock.BrowserWindow.getAllWindows.mockReset();
    electronMock.BrowserWindow.getAllWindows.mockImplementation(() => electronMock.windows);
  });
  afterEach(() => vi.unstubAllEnvs());

  it('每个窗口使用独立缩放，避免按 origin 共享界面尺寸', async () => {
    const { bootstrapDesktopApp } = await import('../bootstrap');
    bootstrapDesktopApp();
    await vi.waitFor(() => expect(electronMock.windows).toHaveLength(1));
    expect(electronMock.windows[0]?.webContents.setZoomMode).toHaveBeenCalledWith('isolated');

    electronMock.BrowserWindow.getAllWindows.mockReturnValue([]);
    electronMock.appListeners.get('activate')?.();
    expect(electronMock.windows[1]?.webContents.setZoomMode).toHaveBeenCalledWith('isolated');
  });
});
