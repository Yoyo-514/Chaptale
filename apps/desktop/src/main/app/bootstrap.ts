import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { configureTrustedRendererUrl } from '../infra/security/trusted-ipc';
import { createAppContext } from './app-context';
import { registerApplicationIpc } from './ipc-registry';
import { createMainWindow } from './main-window';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appUserModelId = 'com.chaptale.desktop';
const isDev = process.env.NODE_ENV === 'development';

/**
 * 装配 Electron 主进程的生命周期、共享服务、IPC 与主窗口。
 *
 * 启动入口只负责确定依赖创建顺序；具体业务由 AppContext 中的服务承担，避免生命周期回调持有分散状态。
 */
export function bootstrapDesktopApp(): void {
  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId(appUserModelId);
    }

    // 开发服务器和打包后的 file URL 共用同一信任入口，必须先配置白名单再创建窗口和注册 IPC。
    const rendererEntryUrl =
      process.env.VITE_DEV_SERVER_URL ?? pathToFileURL(path.join(currentDir, '../renderer/index.html')).toString();
    configureTrustedRendererUrl(rendererEntryUrl);

    const context = createAppContext();
    registerApplicationIpc(context);
    const mainWindow = createMainWindow(rendererEntryUrl);

    // 仅在开发环境注册快捷键，避免生产包暴露调试入口。
    if (isDev) {
      mainWindow.webContents.on('before-input-event', (_event, input) => {
        if (input.key === 'F12' && input.type === 'keyDown') {
          mainWindow.webContents.toggleDevTools();
        }
      });
    }

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(rendererEntryUrl);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
