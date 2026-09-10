import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
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

const createDialog = () => page.getByRole('dialog', { name: '新建作品', exact: true });
const startGuide = () => page.getByRole('complementary', { name: '长篇的第一步', exact: true });
const composer = () => page.getByPlaceholder('描述你的创作需求...');

async function createWorkspace(title: string) {
  await expect(createDialog()).toBeVisible();
  await createDialog().getByRole('textbox', { name: '作品名称', exact: true }).fill(title);
  await createDialog().getByRole('textbox', { name: '作品存放位置', exact: true }).fill(home);
  await createDialog().getByRole('button', { name: '创建并打开', exact: true }).click();
  await expect(createDialog()).toBeHidden();
  await expect(page.locator('.cm-editor')).toBeVisible();
}

test('首启自动弹出新建作品，取消后不再自动重弹', async () => {
  await expect(createDialog()).toBeVisible();
  await expect
    .poll(async () => JSON.parse(await readFile(path.join(home, '.chaptale/settings.json'), 'utf8')).onboarding)
    .toEqual({ completedVersion: 1 });

  await createDialog().getByRole('button', { name: '取消', exact: true }).click();
  await expect(createDialog()).toBeHidden();
  // 没有作品就没有会话落脚点：输入区锁上并把原因写在占位符里，而不是让作者写完才发现发不出去。
  await expect(page.getByPlaceholder('先新建或打开作品，再开始对话')).toBeVisible();
  await expect(composer()).toHaveCount(0);
  // 没有默认模型时，状态栏的「未选择模型」应当是醒目态，而不是一片灰字里的一行。
  await expect(page.getByRole('button', { name: '打开模型设置', exact: true })).toHaveClass(/chat-status-item-missing/);

  // 首启入口只剩文件菜单一个：帮助菜单里不该再留着「开始引导」。
  await page.getByRole('menuitem', { name: '帮助', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '开始引导', exact: true })).toHaveCount(0);
  await page.keyboard.press('Escape');
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建作品…', exact: true }).click();
  await expect(createDialog()).toBeVisible();
  await createDialog().getByRole('button', { name: '取消', exact: true }).click();

  await app.close();
  await launch();
  await expect(page.getByPlaceholder('先新建或打开作品，再开始对话')).toBeVisible();
  await expect(createDialog()).toBeHidden();
});

test('没有配置模型也能建作品，空章节给出第一步并送到故事策划', async () => {
  await createWorkspace('引导之书');

  await expect(page.locator('.titlebar-document-title')).toContainText('引导之书');
  await expect(startGuide()).toContainText('第一章还空着');

  await startGuide().getByRole('button', { name: '帮我理清这个故事', exact: true }).click();

  // 第一步落在「故事策划」的会话里，话术已预填但尚未发出——发不发由作者决定。
  await expect(page.getByRole('button', { name: '对话专员', exact: true })).toContainText('故事策划');
  await expect(composer()).toHaveValue(/我要写：/);
  await expect(composer()).toHaveValue(/暂时不用动笔/);
  await expect(startGuide()).toBeHidden();

  // 全程没有配置任何供应商：第一步不以模型为前提。
  const models = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.models.list());
  expect(models.providers).toEqual([]);
  expect(models.defaultModel).toBeUndefined();

  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'start-guide-and-prefill.png') });
});

test('正文写进字之后不再提示第一步', async () => {
  await createWorkspace('有字之书');

  await expect(startGuide()).toBeVisible();
  await page.getByRole('textbox', { name: '文档正文', exact: true }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('雪落在窗沿，林晚收起了信。');
  await page.keyboard.press('Control+s');

  await expect(page.locator('.document-words')).not.toContainText('0 字');
  await expect(startGuide()).toBeHidden();
});

test('第一步提示在三主题窄窗口可读', async () => {
  await createWorkspace('三主题之书');
  await mkdir(visualDir, { recursive: true });
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setBounds({ width: 1024, height: 720 }));

  for (const theme of ['light', 'warm', 'dark'] as const) {
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    // 主题类由渲染层根据设置落地，直连主进程更新不会推回渲染层，所以要重新加载。
    await page.reload();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme === 'dark' ? 'dark' : `theme-${theme}`));
    // 重载不恢复打开的文档，重新打开首章才有第一步提示。
    await page.getByRole('treeitem', { name: '正文', exact: true }).click();
    await page.locator('[data-tree-path="正文/0001-第一章.md"]').click();
    await expect(startGuide()).toBeVisible();
    const geometry = await startGuide().evaluate(element => ({
      width: element.clientWidth,
      scrollWidth: element.scrollWidth,
      right: element.getBoundingClientRect().right
    }));
    expect(geometry.scrollWidth).toBeLessThanOrEqual(geometry.width + 1);
    expect(geometry.right).toBeLessThanOrEqual(1024);
    await page.screenshot({ path: path.join(visualDir, `${theme}-start-guide.png`) });
  }
});
