import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import { IPC_CHANNELS, type AppPlatformResult } from '@chaptale/ipc-contract';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAgentIpc } from './ipc/agent.ipc';
import { registerSessionIpc } from './ipc/session.ipc';
import { registerWindowIpc } from './ipc/window.ipc';
import { AgentService } from './services/agent.service';
import { ContextService } from './services/context.service';
import { loadRootEnv } from './services/env.service';
import { ModelService } from './services/model.service';
import { JsonlSessionRepository } from './services/session.repository';
import { ToolsService } from './services/tools.service';

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

  loadRootEnv();

  const sessionRepository = new JsonlSessionRepository({
    rootDir: path.join(app.getPath('userData'), 'chaptale'),
    cwd: app.getPath('userData')
  });
  const contextService = new ContextService(sessionRepository);
  const modelService = new ModelService();
  const toolsService = new ToolsService();
  const agentService = new AgentService(contextService, modelService, toolsService);

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
  registerAgentIpc(agentService, contextService);
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
