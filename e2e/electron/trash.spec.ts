import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const desktop = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktop, 'package.json'))('electron') as string;
let application: ElectronApplication;
let page: Page;
let home: string;

async function launch() {
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as Record<string, string | undefined>).VITE_DEV_SERVER_URL;
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath,
    args: [desktop, `--user-data-dir=${path.join(home, 'profile')}`],
    env
  });
  page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
}

test.beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'chaptale-trash-'));
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(path.join(home, '.chaptale/settings.json'), JSON.stringify({ version: 1, workspace: {} }));
  await launch();
});

test.afterEach(async () => {
  if (test.info().status !== test.info().expectedStatus && application?.process().exitCode === null)
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
  await application?.close();
  await rm(home, { recursive: true, force: true });
});

async function createWorkWithDocument(work: string, title: string, text: string) {
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByRole('textbox', { name: '作品名称', exact: true }).fill(work);
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建文稿', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建文档', exact: true }).click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.click();
  await page.keyboard.type(text);
  await body.press('Control+s');
  await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible();
}

async function confirm(name: string) {
  await page.getByRole('alertdialog').getByRole('button', { name, exact: true }).click();
  await expect(page.getByRole('alertdialog')).toHaveCount(0);
}

test('作品目录删除文稿 → 回收站只读预览 → 恢复 → 重启后正文原样', async () => {
  test.setTimeout(60_000);
  await createWorkWithDocument('长夜行', '雨夜', '雨停了。');

  await page.getByRole('treeitem', { name: '雨夜', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('会移入作品回收站，可以恢复。');
  await confirm('删除');
  await expect(page.getByRole('treeitem', { name: '雨夜', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '雨夜', exact: true })).toHaveCount(0);

  const trash = page.getByRole('region', { name: '回收站', exact: true });
  await trash.getByRole('button', { name: /^回收站/ }).click();
  await trash.getByLabel(/^雨夜，删除于/).click();
  const preview = page.getByRole('region', { name: '回收站预览', exact: true });
  await expect(preview).toContainText('在回收站中 · 只读');
  await expect(preview).toContainText('雨停了。');
  await preview.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: '雨夜', exact: true })).toBeVisible();
  await expect(trash).toContainText('回收站是空的。');

  await application.close();
  await launch();
  await page.getByRole('treeitem', { name: '雨夜', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('雨停了。', {
    useInnerText: true
  });
});

test('作品库删除作品 → 作品库回收站恢复 → 打开后文稿仍在', async () => {
  test.setTimeout(60_000);
  await createWorkWithDocument('长夜行', '雨夜', '雨停了。');
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '作品库', exact: true }).click();

  const library = page.getByRole('main', { name: '作品库' });
  await library.getByRole('button', { name: '长夜行', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除作品', exact: true }).click();
  await expect(page.getByRole('alertdialog')).toContainText('作品会移入作品库回收站');
  await confirm('删除');
  await expect(library.getByRole('button', { name: '长夜行', exact: true })).toHaveCount(0);

  await library.getByRole('button', { name: '回收站（1）', exact: true }).click();
  const trashed = library.getByRole('region', { name: '作品库回收站' });
  await expect(trashed.getByRole('row').filter({ hasText: '长夜行' })).toBeVisible();
  await trashed.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(trashed).toContainText('回收站是空的。');
  await library.getByRole('button', { name: '返回作品库', exact: true }).click();
  await library.getByRole('button', { name: '长夜行', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '雨夜', exact: true })).toBeVisible();
});
