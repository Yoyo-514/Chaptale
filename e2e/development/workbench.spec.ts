import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktop = path.resolve('apps/desktop');
const requireDesktop = createRequire(path.join(desktop, 'package.json'));
const visualDir = path.resolve('temp/visual-qa', `development-${Date.now()}`);
let app: ElectronApplication | undefined;
let page: Page;
let home: string;
let diagnostics: string[];
let errors: string[];

test.beforeEach(async () => {
  diagnostics = [];
  errors = [];
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-development-e2e-'));
  const workspace = path.join(home, 'work');
  await mkdir(path.join(workspace, '正文'), { recursive: true });
  await writeFile(path.join(workspace, '正文/第一章.md'), '# 第一章\n\n开发态也应当显示的正文。\n');
  await writeFile(path.join(workspace, '正文/第二章.md'), '# 第二章\n\n另一份正文。\n');
  app = await electron.launch({
    executablePath: requireDesktop('electron') as string,
    args: [desktop, `--user-data-dir=${path.join(home, 'user-data')}`],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NODE_ENV: 'production',
      VITE_DEV_SERVER_URL: 'http://localhost:4318'
    }
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error')
      diagnostics.push(`${message.type()}: ${message.text()}`);
  });
  await page.evaluate(async root => {
    await (window as Window & { chaptaleDesktop: ChaptaleDesktopApi }).chaptaleDesktop.settings.update({
      storage: { mode: 'workspace', workspacePath: root },
      onboarding: { completedVersion: 1 }
    });
  }, workspace);
  await page.reload();
  await expect(page.getByRole('tree', { name: '工作区文件树' })).toBeVisible();
});

test.afterEach(async () => {
  await test.info().attach('renderer-diagnostics', {
    body: JSON.stringify({ diagnostics, errors }, null, 2),
    contentType: 'application/json'
  });
  try {
    if (page && !page.isClosed()) {
      await mkdir(visualDir, { recursive: true });
      await page.screenshot({ path: path.join(visualDir, `${test.info().testId}.png`) });
    }
    await app?.close();
    app = undefined;
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home).startsWith('chaptale-development-e2e-')).toBe(true);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
  expect(diagnostics.filter(message => message.startsWith('error:') || message.includes('[Vue warn]'))).toEqual([]);
});

test('开发态正文挂载、切换与返回保留内容', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.locator('[data-tree-path="正文/第一章.md"]').click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await expect(body).toContainText('开发态也应当显示的正文');
  await expect(body).toBeVisible();
  await page.locator('[data-tree-path="正文/第二章.md"]').click();
  await expect(body).toContainText('另一份正文');
  await page.getByRole('tab', { name: '正文/第一章.md', exact: true }).click();
  await expect(body).toContainText('开发态也应当显示的正文');
  await body.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '与 Agent 讨论此文件' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('开发态侧栏切换互斥并保留文件树展开状态', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.getByRole('button', { name: '审查', exact: true }).click();
  await expect(page.getByRole('region', { name: '审查中心', exact: true })).toBeVisible();
  await expect(page.getByRole('tree', { name: '工作区文件树' })).toBeHidden();
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await expect(page.locator('[data-tree-path="正文/第一章.md"]')).toBeVisible();
  await expect(page.getByRole('region', { name: '审查中心', exact: true })).toHaveCount(0);
});

test('三主题菜单使用柔和边框，活动栏底部保持独立间距', async () => {
  const agent = await page.getByRole('button', { name: '切换 Agent 面板', exact: true }).boundingBox();
  const settings = await page.getByRole('button', { name: '打开设置', exact: true }).boundingBox();
  expect(agent).not.toBeNull();
  expect(settings).not.toBeNull();
  expect(settings!.y - agent!.y - agent!.height).toBeGreaterThanOrEqual(4);
  for (const [label, theme] of [
    ['浅色', 'theme-light'],
    ['暖色', 'theme-warm'],
    ['深色', 'dark']
  ] as const) {
    await page.getByRole('menuitem', { name: '视图', exact: true }).click();
    await page.getByRole('menuitem', { name: '外观', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await page.getByRole('treeitem', { name: '正文', exact: true }).click({ button: 'right' });
    const menu = page.getByRole('menu', { exact: true });
    await expect(menu).toBeVisible();
    const colors = await menu.evaluate(element => {
      const style = getComputedStyle(element);
      return { text: style.color, border: style.borderTopColor, shadow: style.boxShadow };
    });
    expect(colors.border).not.toBe(colors.text);
    expect(colors.shadow).not.toBe('none');
    await mkdir(visualDir, { recursive: true });
    await page.screenshot({ path: path.join(visualDir, `context-menu-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
});
