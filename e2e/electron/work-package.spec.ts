import { expect, test, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

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

async function openLibrary() {
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '作品库', exact: true }).click();
}

/** 系统对话框无法自动操作，在主进程中让保存与打开对话框直接返回指定文件。 */
async function answerDialogs(file: string) {
  await workbench.application.evaluate(({ dialog }, file) => {
    dialog.showSaveDialog = (async () => ({ canceled: false, filePath: file })) as typeof dialog.showSaveDialog;
    dialog.showOpenDialog = (async () => ({ canceled: false, filePaths: [file] })) as typeof dialog.showOpenDialog;
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
  await expect(library.getByRole('status')).toHaveText(`已导出《长夜行》到 ${file}`);

  await library.getByRole('button', { name: '导入作品包', exact: true }).click();
  const dialog = page.getByRole('alertdialog', { name: '作品库中已有《长夜行》' });
  await dialog.getByRole('button', { name: '另存为副本', exact: true }).click();
  await expect(library.getByRole('status')).toHaveText('已导入《长夜行（副本）》');
  await library.getByRole('button', { name: '长夜行（副本）', exact: true }).click();
  await page.getByRole('treeitem', { name: '第一章' }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('夜里下着雨。');

  await openLibrary();
  await library.getByRole('button', { name: '导入作品包', exact: true }).click();
  await dialog.getByRole('button', { name: '覆盖原作品', exact: true }).click();
  await expect(library.getByRole('status')).toHaveText('已导入《长夜行》');
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
  await expect(library.getByRole('status')).toHaveText('已导入《长夜行》');
  await library.getByRole('button', { name: '长夜行', exact: true }).click();
  await page.getByRole('treeitem', { name: '第一章' }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('夜里下着雨。');
});
