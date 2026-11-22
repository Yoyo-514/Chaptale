import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleSettingsState, UpdateChaptaleSettingsPayload } from '@chaptale/desktop/bridge';

const desktopDir = path.resolve('apps/desktop');
const desktopRequire = createRequire(path.join(desktopDir, 'package.json'));
const electronExecutable = desktopRequire('electron') as string;

type DesktopApiWindow = Window & {
  chaptaleDesktop?: {
    getPlatform(): Promise<{ platform: string }>;
    settings: {
      update(payload: UpdateChaptaleSettingsPayload): Promise<ChaptaleSettingsState>;
    };
  };
};

type MainTestState = typeof globalThis & {
  chaptaleOpenedExternalUrl?: string;
};

let electronApp: ElectronApplication;
let mainWindow: Page;
let testHome: string;

test.beforeEach(async () => {
  testHome = await fs.mkdtemp(path.join(os.tmpdir(), 'chaptale-electron-e2e-'));
  const env = { ...process.env };
  delete env.VITE_DEV_SERVER_URL;
  env.NODE_ENV = 'production';
  env.HOME = testHome;
  env.USERPROFILE = testHome;
  await fs.mkdir(path.join(testHome, '.chaptale/creation'), { recursive: true });
  await fs.writeFile(
    path.join(testHome, '.chaptale/settings.json'),
    // 预先选定数据目录，跳过首次启动的位置选择页。
    JSON.stringify({
      version: 1,
      workspace: {},
      dataDir: path.join(testHome, '.chaptale/creation'),
      checkUpdatesOnStartup: false
    })
  );

  electronApp = await electron.launch({
    executablePath: electronExecutable,
    // 隔离 userData：不带这个参数时 Electron 仍按真实用户目录解析 userData，
    // 测试里的缩放、窗口尺寸等状态会落回本机配置。
    args: [desktopDir, `--user-data-dir=${path.join(testHome, 'user-data')}`],
    env
  });
  mainWindow = await electronApp.firstWindow();
  await mainWindow.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await electronApp.close();
  expect(path.dirname(path.resolve(testHome))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(testHome)).toMatch(/^chaptale-electron-e2e-/);
  await fs.rm(testHome, { recursive: true, force: true });
});

test('production renderer exposes the trusted preload IPC facade', async () => {
  const hasDesktopApi = await mainWindow.evaluate(() => Boolean((window as DesktopApiWindow).chaptaleDesktop));
  const platform = await mainWindow.evaluate(() => (window as DesktopApiWindow).chaptaleDesktop?.getPlatform());

  expect(hasDesktopApi).toBe(true);
  expect(platform?.platform).toBe(process.platform);
});

test('production renderer runs with the Chromium sandbox enabled', async () => {
  const sandboxEnabled = await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences().sandbox;
  });

  expect(sandboxEnabled).toBe(true);
});

test('production CSP denies direct renderer networking and declares Chinese', async () => {
  const policy = await mainWindow.locator('meta[http-equiv="Content-Security-Policy"]').getAttribute('content');

  expect(policy).toContain("connect-src 'self'");
  expect(policy).not.toMatch(/localhost|127\.0\.0\.1|ws:/);
  await expect(mainWindow.locator('html')).toHaveAttribute('lang', 'zh-CN');
});

test('external links open outside the app without replacing the trusted renderer', async () => {
  const externalUrl = 'https://example.com/chaptale-security-smoke';
  const rendererUrl = mainWindow.url();

  await electronApp.evaluate(({ shell }) => {
    shell.openExternal = async url => {
      (globalThis as MainTestState).chaptaleOpenedExternalUrl = url;
    };
  });

  await mainWindow.evaluate(url => {
    const link = document.createElement('a');
    link.href = url;
    link.textContent = 'external';
    document.body.append(link);
    link.click();
  }, externalUrl);

  await expect
    .poll(() => electronApp.evaluate(() => (globalThis as MainTestState).chaptaleOpenedExternalUrl))
    .toBe(externalUrl);
  expect(mainWindow.url()).toBe(rendererUrl);
});

test('unsupported file navigation is blocked without leaving the renderer', async () => {
  const rendererUrl = mainWindow.url();

  await mainWindow.evaluate(() => {
    const link = document.createElement('a');
    link.href = 'file:///C:/chaptale-untrusted.html';
    link.textContent = 'untrusted';
    document.body.append(link);
    link.click();
  });

  await mainWindow.waitForTimeout(200);
  expect(mainWindow.url()).toBe(rendererUrl);
});
