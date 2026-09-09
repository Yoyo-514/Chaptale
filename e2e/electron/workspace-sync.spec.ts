import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `workspace-sync-${Date.now()}`);
const original = '# 原稿\n\n作者原有的段落。\n';
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };
let home: string;
let work: string;
let cloud: string;
let app: ElectronApplication | undefined;
let page: Page;
let errors: string[];

test.setTimeout(60_000);
test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-sync-e2e-'));
  work = path.join(home, 'work');
  cloud = path.join(home, 'OneDrive');
  await mkdir(work);
  await mkdir(cloud);
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(path.join(work, 'draft.md'), original);
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    JSON.stringify({
      version: 1,
      storage: { mode: 'workspace', workspacePath: work },
      onboarding: { completedVersion: 1 }
    })
  );
  errors = [];
});
test.afterEach(async () => {
  try {
    if (app && test.info().status !== test.info().expectedStatus && !page.isClosed()) {
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 });
    }
    await app?.close();
    app = undefined;
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home)).toMatch(/^chaptale-sync-e2e-/);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
});

async function launch(oneDrivePath = cloud) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'production',
    HOME: home,
    USERPROFILE: home,
    OneDrive: oneDrivePath,
    OneDriveConsumer: oneDrivePath,
    OneDriveCommercial: ''
  };
  delete env.VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && message.text().includes('[Vue warn]'))) {
      errors.push(message.text());
    }
  });
  await expect(page.getByRole('button', { name: '文件与同步', exact: true })).toBeVisible();
}
async function openDetails() {
  await page.getByRole('button', { name: '文件与同步', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '文件与同步', exact: true });
  await expect(dialog.getByRole('button', { name: '刷新本机状态', exact: true })).toBeEnabled();
  return dialog;
}
async function editDraft(text: string) {
  await page.getByRole('treeitem').filter({ hasText: 'draft.md' }).click();
  const editor = page.locator('.cm-content[contenteditable="true"]');
  await expect(editor).toBeVisible();
  await editor.click();
  await editor.press('Control+End');
  await page.keyboard.insertText(text);
}

test('状态栏和文件菜单均能打开详情，未配置 OneDrive 时不伪造状态', async () => {
  await launch('');
  const dialog = await openDetails();
  await expect(dialog).toContainText(work);
  await expect(dialog).toContainText('未检测到 OneDrive 本机目录');
  await expect(dialog).toContainText('云端状态未知');
  await expect(dialog.locator('.sync-folder')).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await page.getByRole('menuitem', { name: '视图', exact: true }).click();
  await page.locator('[data-item-id="view.status-bar"]').click();
  await expect(page.getByRole('button', { name: '文件与同步', exact: true })).toBeHidden();
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.locator('[data-item-id="file.sync"]').click();
  await expect(dialog).toBeVisible();
});

test('OneDrive 目录去重并可新建作品，三主题窄窗口状态可读', async () => {
  await launch();
  let dialog = await openDetails();
  await expect(dialog.locator('.sync-folder')).toHaveCount(1);
  await expect(dialog).toContainText('本地目录');
  await dialog.getByRole('button', { name: '在此新建作品', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建作品', exact: true });
  await expect(create.getByRole('textbox', { name: '作品存放位置', exact: true })).toHaveValue(cloud);
  await create.getByRole('textbox', { name: '作品名称', exact: true }).fill('云间');
  await create.getByRole('button', { name: '创建并打开', exact: true }).click();
  await expect(create).toBeHidden();
  await expect(page.locator('.cm-content')).toContainText('第一章');
  const target = path.join(cloud, '云间');
  expect(JSON.parse(await readFile(path.join(target, 'chaptale.json'), 'utf8')).title).toBe('云间');
  expect(await readFile(path.join(work, 'draft.md'), 'utf8')).toBe(original);
  const state = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.workspace.getSyncState());
  expect(state).toMatchObject({ rootPath: target, oneDriveRoot: cloud, remoteState: 'unknown' });
  await mkdir(visualDir, { recursive: true });
  for (const theme of ['light', 'warm', 'dark']) {
    await page.getByRole('menuitem', { name: '视图', exact: true }).click();
    await page.getByRole('menuitem', { name: '外观', exact: true }).hover();
    await page.locator(`[data-item-id="view.theme.${theme}"]`).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme === 'dark' ? 'dark' : `theme-${theme}`));
    await app!.evaluate(
      ({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0]!.setSize(width, 760),
      theme === 'dark' ? 1024 : 1360
    );
    dialog = await openDetails();
    await expect(dialog).toContainText('位于 OneDrive 本机目录');
    await expect(dialog).toContainText('云端状态未知');
    expect(
      await dialog.locator('.sync-toolbar .i-mingcute-cloud-line').evaluate(node => getComputedStyle(node).maskImage)
    ).not.toBe('none');
    const fits = await dialog.evaluate(node => ({
      overflow: node.scrollWidth - node.clientWidth,
      right: node.getBoundingClientRect().right,
      width: window.innerWidth
    }));
    expect(fits.overflow).toBeLessThanOrEqual(1);
    expect(fits.right).toBeLessThanOrEqual(fits.width);
    await page.screenshot({ path: path.join(visualDir, `sync-${theme}.png`) });
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  }
});

test('详情保存真实文件，外部冲突能定位处理且不自动覆盖', async () => {
  await launch();
  await editDraft('\n作者新段落');
  let dialog = await openDetails();
  await expect(dialog.locator('.sync-file')).toContainText('未保存');
  await dialog.getByRole('button', { name: '保存 draft.md', exact: true }).click();
  await expect(dialog.locator('.sync-file')).toContainText('本地已保存');
  expect(await readFile(path.join(work, 'draft.md'), 'utf8')).toContain('作者新段落');
  await dialog.getByRole('button', { name: '定位 draft.md', exact: true }).click();
  await editDraft('\n还未保存的作者修改');
  await writeFile(path.join(work, 'draft.md'), '# 其他设备的修订\n');
  await expect(page.getByRole('button', { name: '文件与同步', exact: true })).toContainText('待处理');
  dialog = await openDetails();
  await expect(dialog.locator('.sync-file')).toContainText('版本冲突');
  await dialog.getByRole('button', { name: '刷新本机状态', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '处理冲突', exact: true })).toBeEnabled();
  expect(await readFile(path.join(work, 'draft.md'), 'utf8')).toBe('# 其他设备的修订\n');
  await dialog.getByRole('button', { name: '处理冲突', exact: true }).click();
  const conflict = page.getByRole('dialog', { name: '磁盘版本冲突', exact: true });
  await expect(conflict).toContainText('其他设备的修订');
  await expect(conflict).toContainText('还未保存的作者修改');
  await conflict.getByRole('button', { name: '保留我的', exact: true }).click();
  await expect(conflict).toBeHidden();
  expect(await readFile(path.join(work, 'draft.md'), 'utf8')).toContain('还未保存的作者修改');
  await expect(page.getByRole('button', { name: '文件与同步', exact: true })).toContainText('云端未知');
});

test('磁盘恢复原始版本后刷新清除旧冲突，不丢未保存正文', async () => {
  await launch();
  await editDraft('\n仍在写的段落');
  await writeFile(path.join(work, 'draft.md'), '临时的外部版本');
  await expect(page.getByRole('button', { name: '文件与同步', exact: true })).toContainText('待处理');
  const dialog = await openDetails();
  await writeFile(path.join(work, 'draft.md'), original);
  await dialog.getByRole('button', { name: '刷新本机状态', exact: true }).click();
  await expect(dialog.locator('.sync-file')).toContainText('未保存');
  await expect(dialog.getByRole('button', { name: '处理冲突', exact: true })).toHaveCount(0);
  expect(await readFile(path.join(work, 'draft.md'), 'utf8')).toBe(original);
  await dialog.getByRole('button', { name: '全部保存', exact: true }).click();
  await expect(dialog.locator('.sync-file')).toContainText('本地已保存');
  expect(await readFile(path.join(work, 'draft.md'), 'utf8')).toContain('仍在写的段落');
});

test('失效的 OneDrive 目录保留诊断，目录入口拒绝任意路径', async () => {
  await launch(path.join(home, 'missing-OneDrive'));
  const dialog = await openDetails();
  await expect(dialog.locator('.sync-folder')).toHaveCount(1);
  await expect(dialog.locator('.sync-folder [role="status"]')).not.toBeEmpty();
  await expect(dialog.getByRole('button', { name: '在此新建作品', exact: true })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: '打开作品', exact: true })).toBeDisabled();
  await expect(
    page.evaluate(rootPath => (window as DesktopWindow).chaptaleDesktop.workspace.revealSyncRoot({ rootPath }), work)
  ).rejects.toThrow('不在本机配置');
  await expect(
    page.evaluate(() =>
      (window as DesktopWindow).chaptaleDesktop.workspace.selectParent({ defaultPath: '.', purpose: 'open' })
    )
  ).rejects.toThrow('绝对目录');
  expect(await readFile(path.join(work, 'draft.md'), 'utf8')).toBe(original);
});
