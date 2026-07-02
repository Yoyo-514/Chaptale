import { app, BrowserWindow, ipcMain, Menu, shell } from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { registerAgentIpc } from './ipc/agent.ipc';
import { AgentService } from './services/agent.service';
import { ContextService } from './services/context.service';
import { loadRootEnv } from './services/env.service';
import { ModelService } from './services/model.service';
import { ToolsService } from './services/tools.service';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);

const isDev = process.env.NODE_ENV === 'development';

function createMainWindow() {
  const window = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 960,
    minHeight: 640,
    title: 'Chaptale',
    icon: path.join(currentDir, '../../resources/favicon.ico'),
    // 隐藏系统标题栏文字，保留原生窗口控制按钮
    titleBarStyle: 'hidden',
    // Windows/Linux 下显示原生窗口控制按钮（覆盖在页面上）
    ...(process.platform !== 'darwin'
      ? {
          titleBarOverlay: {
            color: '#0a0a0e',
            symbolColor: '#a0a0a8',
            height: 36
          }
        }
      : {}),
    backgroundColor: '#101014',
    webPreferences: {
      preload: path.join(currentDir, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

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
  loadRootEnv();

  const contextService = new ContextService();
  const modelService = new ModelService();
  const toolsService = new ToolsService();
  const agentService = new AgentService(contextService, modelService, toolsService);

  ipcMain.handle('app:get-platform', () => ({
    platform: process.platform,
    versions: process.versions
  }));

  registerAgentIpc(agentService, contextService);

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
