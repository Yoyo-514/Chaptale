import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const desktopDir = path.resolve('apps/desktop');
const desktopRequire = createRequire(path.join(desktopDir, 'package.json'));
const electronExecutable = desktopRequire('electron') as string;

type DesktopApiWindow = Window & {
  chaptaleDesktop?: {
    getPlatform(): Promise<{ platform: string }>;
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
  delete env.ELECTRON_RENDERER_URL;
  env.NODE_ENV = 'production';
  env.HOME = testHome;
  env.USERPROFILE = testHome;

  electronApp = await electron.launch({
    executablePath: electronExecutable,
    args: [desktopDir],
    env
  });
  mainWindow = await electronApp.firstWindow();
  await mainWindow.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await electronApp.close();
  await fs.rm(testHome, { recursive: true, force: true });
});

test('production renderer exposes the trusted preload IPC facade', async () => {
  const hasDesktopApi = await mainWindow.evaluate(() => Boolean((window as DesktopApiWindow).chaptaleDesktop));
  const platform = await mainWindow.evaluate(() => (window as DesktopApiWindow).chaptaleDesktop?.getPlatform());

  expect(hasDesktopApi).toBe(true);
  expect(platform?.platform).toBe(process.platform);
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
