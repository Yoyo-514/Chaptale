import { BrowserWindow, Menu, shell, type Event as ElectronEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExternalUrl, isTrustedRendererUrl } from '../infra/security/navigation-security';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appIconPath = path.join(currentDir, '../../resources/favicon.ico');
const isDev = process.env.NODE_ENV === 'development';

export function createMainWindow(rendererEntryUrl: string): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Chaptale',
    icon: appIconPath,
    // 使用自定义标题栏和窗口控制按钮，避免原生控件与应用视觉风格割裂。
    frame: false,
    backgroundColor: '#fffaf2',
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  if (process.platform === 'win32') {
    window.setIcon(appIconPath);
  }

  // 隐藏默认菜单栏
  Menu.setApplicationMenu(null);

  window.webContents.setWindowOpenHandler(({ url }) => {
    if (isExternalUrl(url)) {
      void shell.openExternal(url);
    }

    return { action: 'deny' };
  });

  const handleNavigation = (event: ElectronEvent, url: string) => {
    if (isTrustedRendererUrl(url, rendererEntryUrl)) {
      return;
    }

    event.preventDefault();

    if (isExternalUrl(url)) {
      void shell.openExternal(url);
    }
  };

  window.webContents.on('will-navigate', handleNavigation);
  window.webContents.on('will-redirect', handleNavigation);

  void window.loadURL(rendererEntryUrl);

  if (isDev) {
    window.webContents.openDevTools();
  }

  return window;
}
