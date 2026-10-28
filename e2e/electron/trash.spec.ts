import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('trash');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

async function createWorkWithDocument(work: string, title: string, text: string) {
  await workbench.createWork(work);
  await workbench.createDocument(title, text);
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

  await workbench.restart();
  page = workbench.page;
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
