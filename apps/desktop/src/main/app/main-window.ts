import { BrowserWindow, Menu, shell, type Event as ElectronEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isExternalUrl, isTrustedRendererUrl } from '../infra/security/navigation-security';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appIconPath = path.join(currentDir, '../../resources/favicon.ico');
const isDev = process.env.NODE_ENV === 'development';

/**
 * 创建承载 Renderer 的主窗口，并把导航限制在受信入口。
 *
 * 新窗口请求一律交由系统浏览器或拒绝，防止外部页面继承应用窗口的 Electron 能力边界。
 */
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

  // 应用使用自定义命令与标题栏，移除原生菜单可避免出现未纳入权限设计的默认入口。
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
