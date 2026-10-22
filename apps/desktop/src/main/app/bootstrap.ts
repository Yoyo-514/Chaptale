import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { registerApplicationHostIpc } from '../application-host/ipc';
import { DesktopApplicationProcess } from '../application-host/process';
import { configureTrustedRendererUrl } from '../infra/security/trusted-ipc';
import { createAppContext } from './app-context';
import { registerApplicationIpc } from './ipc-registry';
import { createMainWindow } from './main-window';

const currentFilePath = fileURLToPath(import.meta.url);
const currentDir = path.dirname(currentFilePath);
const appUserModelId = 'com.chaptale.desktop';

/**
 * 装配 Electron 主进程的生命周期、共享服务、IPC 与主窗口。
 *
 * 启动入口只负责确定依赖创建顺序；具体业务由 AppContext 中的服务承担，避免生命周期回调持有分散状态。
 */
export function bootstrapDesktopApp(): void {
  app.whenReady().then(async () => {
    if (process.platform === 'win32') {
      app.setAppUserModelId(appUserModelId);
    }

    // 开发服务器和打包后的 file URL 共用同一信任入口，必须先配置白名单再创建窗口和注册 IPC。
    const rendererEntryUrl =
      process.env.VITE_DEV_SERVER_URL ?? pathToFileURL(path.join(currentDir, '../renderer/index.html')).toString();
    configureTrustedRendererUrl(rendererEntryUrl);

    const context = createAppContext();
    const hostRoot = path.join(context.settingsService.rootDir, 'pi');
    const host = new DesktopApplicationProcess({
      script: path.join(currentDir, 'application-host.js'),
      creationDir: path.join(context.settingsService.rootDir, 'creation'),
      agent: {
        cwd: path.join(hostRoot, 'work'),
        configDir: path.join(hostRoot, 'config'),
        agentDir: path.join(hostRoot, 'agent'),
        sessionDir: path.join(hostRoot, 'sessions'),
        settingsFile: path.join(hostRoot, 'settings.json')
      }
    });
    registerApplicationHostIpc(host);
    let stopping = false;
    let stopped = false;
    // 窗口关闭已获确认后再停止宿主；取消退出时，后台会话继续运行。
    app.on('will-quit', event => {
      if (stopped) return;
      event.preventDefault();
      if (stopping) return;
      stopping = true;
      context.autoBackupScheduler.stop();
      const finish = () => {
        stopped = true;
        app.quit();
      };
      void Promise.all([host.dispose(), context.workspaceService.dispose()]).then(finish, () => {
        console.error('退出时资源释放失败');
        finish();
      });
    });
    registerApplicationIpc(context);
    // 心跳在窗口建好之前就可以跑：第一拍要等一分钟，而那时作品与登录状态都已经落定。
    context.autoBackupScheduler.start();
    // 主题要在建窗口之前读到：backgroundColor 决定首帧之前那一瞬露出的底色，
    // 建完再改就已经闪过去了。
    const { theme } = await context.settingsService.readSettings();
    createMainWindow(rendererEntryUrl, theme);

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createMainWindow(rendererEntryUrl, theme);
      }
    });
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      app.quit();
    }
  });
}
