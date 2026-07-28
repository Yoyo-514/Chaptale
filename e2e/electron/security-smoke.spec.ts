import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { promises as fs } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type {
  ChaptaleSettingsState,
  TaskReadRunOutputResult,
  UpdateChaptaleSettingsPayload
} from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const desktopRequire = createRequire(path.join(desktopDir, 'package.json'));
const electronExecutable = desktopRequire('electron') as string;

type DesktopApiWindow = Window & {
  chaptaleDesktop?: {
    getPlatform(): Promise<{ platform: string }>;
    settings: {
      update(payload: UpdateChaptaleSettingsPayload): Promise<ChaptaleSettingsState>;
    };
    tasks: {
      readRunOutput(outputRef: string): Promise<TaskReadRunOutputResult | null>;
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

test('tasks.readRunOutput only reads direct review refs inside the configured workspace', async () => {
  const workspacePath = path.join(testHome, 'workspace');
  const globalCwdPath = path.join(testHome, '.chaptale', 'agent', 'global');
  const workspaceReviewOutput = {
    summary: '工作区审查摘要',
    issues: [
      {
        agentType: 'continuity',
        type: 'timeline',
        severity: 'high',
        quote: '门已经关上',
        reason: '前后状态冲突',
        suggestion: '统一时间线'
      }
    ]
  };
  const globalReviewOutput = {
    summary: '全局审查摘要',
    issues: [
      {
        agentType: 'continuity',
        type: 'timeline',
        severity: 'medium',
        quote: '全局目录里的旧结果',
        reason: '用于验证不能回退到 global cwd',
        suggestion: '应优先读取 workspace'
      }
    ]
  };

  await fs.mkdir(path.join(globalCwdPath, '.chaptale', 'reviews'), { recursive: true });
  await fs.mkdir(path.join(workspacePath, '.chaptale', 'reviews'), { recursive: true });
  await fs.writeFile(
    path.join(globalCwdPath, '.chaptale', 'reviews', 'run-e2e.json'),
    JSON.stringify(globalReviewOutput),
    'utf8'
  );
  await fs.writeFile(
    path.join(workspacePath, '.chaptale', 'reviews', 'run-e2e.json'),
    JSON.stringify(workspaceReviewOutput),
    'utf8'
  );

  const result = await mainWindow.evaluate(async workspace => {
    const api = (window as DesktopApiWindow).chaptaleDesktop;
    if (!api) {
      return null;
    }

    const state = await api.settings.update({ storage: { mode: 'workspace', workspacePath: workspace } });
    const valid = await api.tasks.readRunOutput('.chaptale/reviews/run-e2e.json');
    const stateFile = await api.tasks.readRunOutput('.chaptale/reviews/run-e2e.state.json');
    const traversal = await api.tasks.readRunOutput('../run-e2e.json');
    const wrongDirectory = await api.tasks.readRunOutput('.chaptale/runs/outputs/run-e2e.json');

    return {
      currentCwd: state.paths.currentCwd,
      storage: state.settings.storage,
      valid,
      stateFile,
      traversal,
      wrongDirectory
    };
  }, workspacePath);

  expect(result).not.toBeNull();
  expect(result?.currentCwd).toBe(workspacePath);
  expect(result?.storage).toEqual({ mode: 'workspace', workspacePath });
  expect(result?.valid).toEqual({ kind: 'review', runId: 'run-e2e', output: workspaceReviewOutput });
  expect(result?.valid).not.toEqual({ kind: 'review', runId: 'run-e2e', output: globalReviewOutput });
  expect(result?.stateFile).toBeNull();
  expect(result?.traversal).toBeNull();
  expect(result?.wrongDirectory).toBeNull();
});

test('production renderer runs with the Chromium sandbox enabled', async () => {
  const sandboxEnabled = await electronApp.evaluate(({ BrowserWindow }) => {
    return BrowserWindow.getAllWindows()[0]?.webContents.getLastWebPreferences().sandbox;
  });

  expect(sandboxEnabled).toBe(true);
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
