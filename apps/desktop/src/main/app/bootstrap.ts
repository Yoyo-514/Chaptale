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

export function bootstrapDesktopApp(): void {
  app.whenReady().then(() => {
    if (process.platform === 'win32') {
      app.setAppUserModelId(appUserModelId);
    }

    const rendererEntryUrl =
      process.env.ELECTRON_RENDERER_URL ?? pathToFileURL(path.join(currentDir, '../renderer/index.html')).toString();
    configureTrustedRendererUrl(rendererEntryUrl);

    const context = createAppContext();
    registerApplicationIpc(context);
    const mainWindow = createMainWindow(rendererEntryUrl);

    // Dev 环境下支持 F12 开关 DevTools
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
