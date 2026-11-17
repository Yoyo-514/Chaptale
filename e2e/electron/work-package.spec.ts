import { expect, test, type Page } from '@playwright/test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('work-package');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

const notice = () => page.getByRole('region', { name: '通知中心' });

async function openLibrary() {
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '作品库', exact: true }).click();
}

/** 系统对话框无法自动操作，在主进程中让保存与打开对话框直接返回指定文件。 */
async function answerDialogs(file: string) {
  await workbench.application.evaluate(({ dialog }, target) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: target })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [target] })) as typeof dialog.showOpenDialog;
  }, file);
}

test('作品库导出作品包后导入为副本与覆盖原作品，正文随包恢复', async () => {
  await workbench.createWork('长夜行');
  await workbench.createDocument('第一章', '夜里下着雨。');
  await openLibrary();
  await mkdir(test.info().outputDir, { recursive: true });
  const file = path.join(test.info().outputDir, '长夜行.chaptale');
  await answerDialogs(file);

  const library = page.getByRole('main', { name: '作品库' });
  await library.getByRole('button', { name: '长夜行', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '导出作品包', exact: true }).click();
  await expect(notice()).toContainText(`已导出《长夜行》${file}`);

  await library.getByRole('button', { name: '导入作品包', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '作品库中已有《长夜行》' });
  await dialog.getByRole('button', { name: '另存为副本', exact: true }).click();
  await expect(notice()).toContainText('已导入《长夜行（副本）》');
  await library.getByRole('button', { name: '长夜行（副本）', exact: true }).click();
  await page.getByRole('treeitem', { name: '第一章' }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('夜里下着雨。');

  await openLibrary();
  await library.getByRole('button', { name: '导入作品包', exact: true }).click();
  await dialog.getByRole('button', { name: '覆盖原作品', exact: true }).click();
  await expect(notice()).toContainText('已导入《长夜行》');
  await expect(library.getByRole('button', { name: /^长夜行/ })).toHaveCount(2);
  await library.getByRole('button', { name: '长夜行', exact: true }).click();
  await page.getByRole('treeitem', { name: '第一章' }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('夜里下着雨。');
});

test('菜单栏在作品内导出当前作品，导入时转到作品库选择覆盖', async () => {
  await workbench.createWork('长夜行');
  await workbench.createDocument('第一章', '夜里下着雨。');
  await mkdir(test.info().outputDir, { recursive: true });
  const file = path.join(test.info().outputDir, '菜单导出.chaptale');
  await answerDialogs(file);
  const fileMenu = page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true });
  await fileMenu.click();
  await page.getByRole('menuitem', { name: '导出作品包…', exact: true }).click();
  await expect.poll(() => existsSync(file)).toBe(true);

  await fileMenu.click();
  await page.getByRole('menuitem', { name: '导入作品包…', exact: true }).click();
  const library = page.getByRole('main', { name: '作品库' });
  await page
    .getByRole('alertdialog', { name: '作品库中已有《长夜行》' })
    .getByRole('button', { name: '覆盖原作品', exact: true })
    .click();
  await expect(notice()).toContainText('已导入《长夜行》');
  await library.getByRole('button', { name: '长夜行', exact: true }).click();
  await page.getByRole('treeitem', { name: '第一章' }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('夜里下着雨。');
});

test('覆盖导入后可从作品库恢复导入前的版本', async () => {
  await workbench.createWork('长夜行');
  await workbench.createDocument('第一章', '夜里下着雨。');
  await mkdir(test.info().outputDir, { recursive: true });
  const file = path.join(test.info().outputDir, '恢复.chaptale');
  await answerDialogs(file);
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  const fileMenu = page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true });
  await fileMenu.click();
  await page.getByRole('menuitem', { name: '导出作品包…', exact: true }).click();
  await expect.poll(() => existsSync(file)).toBe(true);
  await body.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('雨停了。');
  await page.keyboard.press('Control+S');
  await expect(body).toContainText('雨停了。');

  await fileMenu.click();
  await page.getByRole('menuitem', { name: '导入作品包…', exact: true }).click();
  await page
    .getByRole('alertdialog', { name: '作品库中已有《长夜行》' })
    .getByRole('button', { name: '覆盖原作品', exact: true })
    .click();
  const library = page.getByRole('main', { name: '作品库' });
  await expect(notice()).toContainText('已导入《长夜行》');

  await library.getByRole('button', { name: '长夜行', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '恢复导入前的版本', exact: true }).click();
  await page.getByRole('alertdialog').getByRole('button', { name: '恢复', exact: true }).click();
  await expect(notice()).toContainText('已恢复《长夜行》导入前的版本');
  await library.getByRole('button', { name: '长夜行', exact: true }).click();
  await page.getByRole('treeitem', { name: '第一章' }).click();
  await expect(body).toContainText('雨停了。');

  await fileMenu.click();
  await page.getByRole('menuitem', { name: '作品库', exact: true }).click();
  await library.getByRole('button', { name: '长夜行', exact: true }).click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '恢复导入前的版本', exact: true })).toHaveCount(0);
});

test('作品库结构版本过新时只有这部作品打不开，重启后回到作品库并说明原因', async () => {
  await workbench.createWork('长夜行');
  await workbench.createDocument('第一章', '夜里下着雨。');
  await workbench.application.close();
  const works = path.join(workbench.home, '.chaptale/creation/works');
  const [workId] = readdirSync(works);
  const database = new DatabaseSync(path.join(works, workId!, 'work.sqlite'));
  database.exec('PRAGMA user_version = 9');
  database.close();
  await workbench.launch();
  page = workbench.page;

  const library = page.getByRole('main', { name: '作品库' });
  const reason = '作品库由更新版本的 Chaptale 创建（结构第 9 版），请升级应用后打开';
  await expect(library.getByRole('alert')).toHaveText(`无法打开上次的作品：${reason}`);
  await expect(library.getByRole('button', { name: '重新连接' })).toHaveCount(0);
  await workbench.createWork('新作品');
  await expect(page.getByRole('heading', { name: '作品库', exact: true })).toHaveCount(0);
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '作品库', exact: true }).click();
  await library.getByRole('button', { name: '长夜行', exact: true }).click();
  await expect(library.getByRole('alert')).toHaveText(reason);
});
