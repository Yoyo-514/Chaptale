import { IPC_CHANNELS, type AppPlatformResult } from '@chaptale/ipc-contract';
import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAgentIpc } from './ipc/agent.ipc';
import { registerModelsIpc } from './ipc/models.ipc';
import { registerSessionIpc } from './ipc/session.ipc';
import { registerSettingsIpc } from './ipc/settings.ipc';
import { registerWindowIpc } from './ipc/window.ipc';
import { PiAgentService } from './services/pi-agent.service';
import { PiModelService } from './services/pi-model.service';
import { PiSessionRepository } from './services/session.repository';
import { SettingsService } from './services/settings.service';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appIconPath = path.join(currentDir, '../../resources/favicon.ico');
const appUserModelId = 'com.chaptale.desktop';

const isDev = process.env.NODE_ENV === 'development';

function createMainWindow() {
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
    void shell.openExternal(url);
    return { action: 'deny' };
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void window.loadFile(path.join(currentDir, '../renderer/index.html'));
  }

  if (isDev) {
    window.webContents.openDevTools();
  }

  return window;
}

app.whenReady().then(() => {
  if (process.platform === 'win32') {
    app.setAppUserModelId(appUserModelId);
  }

  const settingsService = new SettingsService();
  const sessionRepository = new PiSessionRepository({
    rootDir: settingsService.agentDir,
    cwd: () => settingsService.getCurrentCwd(),
    sessionDir: () => settingsService.getCurrentSessionDir(),
    getStorageContext: () => settingsService.getStorageContext()
  });
  const piModelService = new PiModelService(settingsService);
  const piAgentService = new PiAgentService(settingsService, piModelService);

  ipcMain.handle(
    IPC_CHANNELS.app.getPlatform,
    () =>
      ({
        platform: process.platform,
        versions: Object.fromEntries(
          Object.entries(process.versions).filter((entry): entry is [string, string] => entry[1] !== undefined)
        )
      }) satisfies AppPlatformResult
  );

  registerSessionIpc(sessionRepository);
  registerSettingsIpc(settingsService, () => piAgentService.invalidateSessions());
  registerModelsIpc(piModelService);
  registerAgentIpc(piAgentService);
  registerWindowIpc();

  const mainWindow = createMainWindow();

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
      createMainWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
