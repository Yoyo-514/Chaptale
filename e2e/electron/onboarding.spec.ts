import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `onboarding-${Date.now()}`);
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };
let home: string;
let app: ElectronApplication;
let page: Page;
let errors: string[];
async function launch() {
  const env = { ...process.env, NODE_ENV: 'production', HOME: home, USERPROFILE: home };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
}
test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-onboarding-e2e-'));
  errors = [];
  await launch();
});
test.afterEach(async () => {
  try {
    if (test.info().status !== test.info().expectedStatus && !page.isClosed()) {
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 });
    }
    await app.close();
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home)).toMatch(/^chaptale-onboarding-e2e-/);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
});
const guide = () => page.getByRole('dialog', { name: '开始创作', exact: true });
async function reopenGuide() {
  await page.getByRole('menuitem', { name: '帮助', exact: true }).click();
  await page.getByRole('menuitem', { name: '开始引导', exact: true }).click();
  await expect(guide()).toBeVisible();
}

test('M6 首次启动可跳过，重启不重复弹出，帮助菜单可重进', async () => {
  await expect(guide()).toBeVisible();
  await guide().getByRole('button', { name: '跳过', exact: true }).click();
  await expect(guide()).toBeHidden();
  await expect
    .poll(async () => JSON.parse(await readFile(path.join(home, '.chaptale/settings.json'), 'utf8')).onboarding)
    .toEqual({ completedVersion: 1 });
  await app.close();
  await launch();
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible();
  await expect(guide()).toBeHidden();
  await reopenGuide();
  await guide().getByRole('button', { name: '跳过开始引导', exact: true }).click();
  await expect(guide()).toBeHidden();
  const state = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.models.list());
  expect(state.defaultModel).toBeUndefined();
  expect(state.providers).toHaveLength(0);
});

test('M6 无模型也能完成引导并创建可编辑作品，写作偏好一起保存', async () => {
  await guide().getByRole('button', { name: '下一步', exact: true }).click();
  await guide().getByRole('combobox', { name: '引导主题', exact: true }).click();
  await page.getByRole('option', { name: '暖色', exact: true }).click();
  await guide().getByRole('checkbox', { name: '自动保存正文', exact: true }).check();
  await guide().getByRole('button', { name: '下一步', exact: true }).click();
  await expect(guide()).toContainText('未配置');
  await guide().getByRole('button', { name: '新建作品', exact: true }).click();
  const creating = page.getByRole('dialog', { name: '新建作品', exact: true });
  await expect(creating).toBeVisible();
  await creating.getByRole('textbox', { name: '作品名称', exact: true }).fill('引导之书');
  await creating.getByRole('textbox', { name: '作品存放位置', exact: true }).fill(home);
  await creating.getByRole('button', { name: '创建并打开', exact: true }).click();
  await expect(creating).toBeHidden();
  await expect(page.locator('.cm-editor')).toBeVisible();
  await expect(page.locator('.titlebar-document-title')).toContainText('引导之书');
  const state = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.settings.getState());
  expect(state.settings).toMatchObject({
    onboarding: { completedVersion: 1 },
    theme: 'warm',
    editor: { autoSave: true },
    storage: { mode: 'workspace', workspacePath: path.join(home, '引导之书') }
  });
  await reopenGuide();
  await expect(guide().getByRole('combobox', { name: '作品起点', exact: true })).toContainText('继续当前作品');
  await guide().getByRole('tab', { name: 'AI 助手', exact: true }).click();
  await guide().getByRole('button', { name: '管理专员', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专员与创作内容', exact: true })).toBeVisible();
});

test('M6 引导跳过不提交偏好草稿，持久化失败也不阻挡工作台', async () => {
  await guide().getByRole('tab', { name: '写作环境', exact: true }).click();
  await guide().getByRole('checkbox', { name: '自动保存正文', exact: true }).check();
  const settingsPath = path.join(home, '.chaptale/settings.json');
  await rename(settingsPath, `${settingsPath}.previous`);
  await mkdir(settingsPath);
  await guide().getByRole('button', { name: '跳过', exact: true }).click();
  await expect(guide()).toBeHidden();
  await expect(page.getByRole('button', { name: '打开设置', exact: true })).toBeVisible();
  const previous = JSON.parse(await readFile(`${settingsPath}.previous`, 'utf8'));
  expect(previous.editor.autoSave).toBe(false);
  await expect(page.locator('.notification-center')).toContainText('更新设置失败');
});

test('M6 开始引导在三主题窄窗口可读，键盘焦点留在对话框内', async () => {
  await mkdir(visualDir, { recursive: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1024, height: 720 }));
  for (const theme of ['light', 'warm', 'dark'] as const) {
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    await page.reload();
    await expect(guide()).toBeVisible();
    for (const [step, name] of [
      ['workspace', '作品'],
      ['environment', '写作环境'],
      ['assistant', 'AI 助手']
    ]) {
      await guide().getByRole('tab', { name, exact: true }).click();
      const geometry = await guide().evaluate(element => ({
        width: element.clientWidth,
        scrollWidth: element.scrollWidth,
        height: element.getBoundingClientRect().height
      }));
      expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
      expect(geometry.height).toBeLessThan(680);
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
      await page.screenshot({ path: path.join(visualDir, `${theme}-${step}.png`) });
    }
  }
  await guide().getByRole('button', { name: '跳过', exact: true }).click();
});
