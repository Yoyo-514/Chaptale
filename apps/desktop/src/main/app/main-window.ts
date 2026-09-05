import { BrowserWindow, Menu, shell, type Event as ElectronEvent } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ChaptaleTheme } from '@chaptale/ipc-contract';

import { isExternalUrl, isTrustedRendererUrl } from '../infra/security/navigation-security';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appIconPath = path.join(currentDir, '../../resources/favicon.ico');
const isDev = process.env.NODE_ENV === 'development';

/**
 * 窗口创建到首帧之间露出的底色。
 *
 * 主进程读不到样式表，只能在这里复刻一份：取值须与各主题的 --background 相同，
 * 对不上时启动会闪一道异色。
 */
const THEME_BACKGROUND: Record<ChaptaleTheme, string> = {
  light: '#f4f7f9',
  warm: '#f8f3e7',
  dark: '#0f1e26'
};

/**
 * 创建承载 Renderer 的主窗口，并把导航限制在受信入口。
 *
 * 新窗口请求一律交由系统浏览器或拒绝，防止外部页面继承应用窗口的 Electron 能力边界。
 */
export function createMainWindow(rendererEntryUrl: string, theme: ChaptaleTheme): BrowserWindow {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Chaptale',
    icon: appIconPath,
    // 使用自定义标题栏和窗口控制按钮，避免原生控件与应用视觉风格割裂。
    frame: false,
    backgroundColor: THEME_BACKGROUND[theme],
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.mjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });

  if (process.platform === 'win32') {
    window.setIcon(appIconPath);
  }

  // Chromium 默认把 zoom 按 origin 持久化到 userData：一次误触 Ctrl+滚轮就会永久改变整个界面尺寸，
  // 而应用自己既没有缩放入口也没有重置入口，用户改不回来。
  // disabled 模式会把当前 webContents 拉回默认缩放并忽略后续变更，顺带抗掉已经落盘的旧值。
  // 将来真要做「界面缩放」设置项，该改成 manual + 从 settings 读取，而不是放开 default。
  window.webContents.setZoomMode('disabled');

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
