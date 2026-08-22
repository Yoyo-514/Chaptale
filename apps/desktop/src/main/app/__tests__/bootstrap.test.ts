import { beforeEach, describe, expect, it, vi } from 'vitest';

const electronMock = vi.hoisted(() => {
  const windows: Array<{
    loadURL: ReturnType<typeof vi.fn>;
    setIcon: ReturnType<typeof vi.fn>;
    webContents: {
      on: ReturnType<typeof vi.fn>;
      openDevTools: ReturnType<typeof vi.fn>;
      setWindowOpenHandler: ReturnType<typeof vi.fn>;
      toggleDevTools: ReturnType<typeof vi.fn>;
    };
  }> = [];
  const appListeners = new Map<string, () => void>();

  const BrowserWindow = vi.fn(function BrowserWindow() {
    const window = {
      loadURL: vi.fn(),
      setIcon: vi.fn(),
      webContents: {
        on: vi.fn(),
        openDevTools: vi.fn(),
        setWindowOpenHandler: vi.fn(),
        toggleDevTools: vi.fn()
      }
    };
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
    Menu: {
      setApplicationMenu: vi.fn()
    },
    shell: {
      openExternal: vi.fn()
    }
  };
});

vi.mock('electron', () => ({
  app: electronMock.app,
  BrowserWindow: electronMock.BrowserWindow,
  Menu: electronMock.Menu,
  shell: electronMock.shell
}));

vi.mock('../app-context', () => ({
  // 建窗口前要先读到主题（决定首帧之前那一瞬的窗口底色），替身得给得出这一步。
  createAppContext: vi.fn(() => ({
    settingsService: { readSettings: vi.fn(async () => ({ theme: 'dark' })) }
  }))
}));

vi.mock('../ipc-registry', () => ({
  registerApplicationIpc: vi.fn()
}));

vi.mock('../../infra/security/trusted-ipc', () => ({
  configureTrustedRendererUrl: vi.fn()
}));

function getBeforeInputListener(
  windowIndex: number
): ((event: unknown, input: { key: string; type: string }) => void) | undefined {
  const call = electronMock.windows[windowIndex]?.webContents.on.mock.calls.find(
    ([event]) => event === 'before-input-event'
  );
  return call?.[1] as ((event: unknown, input: { key: string; type: string }) => void) | undefined;
}

describe('bootstrapDesktopApp', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.stubEnv('NODE_ENV', 'development');
    electronMock.windows.length = 0;
    electronMock.appListeners.clear();
    electronMock.BrowserWindow.mockClear();
    electronMock.BrowserWindow.getAllWindows.mockReset();
    electronMock.BrowserWindow.getAllWindows.mockImplementation(() => electronMock.windows);
  });

  it('仅为开发模式启动时的首次窗口绑定 F12 监听', async () => {
    // 必须动态导入：stubEnv(NODE_ENV) 与 vi.resetModules 要求每个用例重新求值模块，
    // bootstrap 在模块求值期读 NODE_ENV，静态导入只求值一次、读不到各自的环境。
    const { bootstrapDesktopApp } = await import('../bootstrap');

    bootstrapDesktopApp();
    await vi.waitFor(() => expect(electronMock.windows).toHaveLength(1));

    const initialListener = getBeforeInputListener(0);
    expect(initialListener).toBeTypeOf('function');
    initialListener?.({}, { key: 'F12', type: 'keyDown' });
    expect(electronMock.windows[0]?.webContents.toggleDevTools).toHaveBeenCalledOnce();

    electronMock.BrowserWindow.getAllWindows.mockReturnValue([]);
    electronMock.appListeners.get('activate')?.();

    expect(electronMock.windows).toHaveLength(2);
    expect(getBeforeInputListener(1)).toBeUndefined();
  });
});
