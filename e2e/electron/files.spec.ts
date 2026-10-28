import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;
let outside: string;
// 1×1 PNG。
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64'
);

test.beforeEach(async () => {
  workbench = await Workbench.start('files');
  page = workbench.page;
  outside = await mkdtemp(path.join(tmpdir(), 'chaptale-files-source-'));
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
  await rm(outside, { recursive: true, force: true });
});

/** 仅替换下一次系统文件选择结果；复制、登记与刷新走真实链路。 */
async function addFiles(names: string[]) {
  const paths = names.map(name => path.join(outside, name));
  await workbench.application.evaluate(({ dialog }, selected) => {
    const original = dialog.showOpenDialog;
    dialog.showOpenDialog = async () => {
      dialog.showOpenDialog = original;
      return { canceled: false, filePaths: selected };
    };
  }, paths);
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '添加文件…', exact: true }).click();
}

test('保存前后连续添加多张图片，选作封面，预览与重启后保留；封面图片删除后显示未设置', async () => {
  test.setTimeout(90_000);
  for (const name of ['a.png', 'b.png', 'c.png']) await writeFile(path.join(outside, name), png);
  await writeFile(path.join(outside, '设定.pdf'), 'pdf');
  await workbench.createWork('长夜行');
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建资料', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('林晚');
  await page.getByRole('button', { name: '创建文档', exact: true }).click();
  await page.getByRole('textbox', { name: '文档正文', exact: true }).click();
  await page.keyboard.insertText('人物小传');
  await expect(page.getByRole('tab', { name: '林晚（未保存）', exact: true })).toBeVisible();

  await addFiles(['a.png', 'b.png']);
  await expect(page.getByRole('treeitem', { name: 'b.png', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '文档正文', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { name: '林晚', exact: true })).toBeVisible();
  await addFiles(['c.png', '设定.pdf']);
  for (const name of ['a.png', 'b.png', 'c.png', '设定.pdf'])
    await expect(page.getByRole('treeitem', { name, exact: true })).toBeVisible();

  await page.getByRole('treeitem', { name: 'c.png', exact: true }).click();
  const lightbox = page.getByRole('dialog', { name: 'c.png', exact: true });
  await expect(lightbox.locator('img')).toBeVisible();
  await lightbox.getByRole('button', { name: '关闭预览', exact: true }).click();
  await expect(lightbox).toHaveCount(0);

  await page.getByRole('tab', { name: '林晚', exact: true }).click();
  const panel = page.getByRole('region', { name: '资料属性', exact: true });
  await panel.getByRole('button', { name: /^属性/ }).click();
  await panel.getByRole('combobox', { name: '封面', exact: true }).click();
  await expect(page.getByRole('option', { name: '设定.pdf', exact: true })).toHaveCount(0);
  await page.getByRole('option', { name: 'b.png', exact: true }).click();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { name: '林晚', exact: true })).toBeVisible();

  await workbench.restart();
  page = workbench.page;
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  for (const name of ['a.png', 'b.png', 'c.png', '设定.pdf'])
    await expect(page.getByRole('treeitem', { name, exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: '林晚', exact: true }).click();
  const cover = page.getByRole('button', { name: '查看封面 b.png', exact: true });
  await expect(cover.locator('img')).toBeVisible();
  await cover.click();
  await expect(page.getByRole('dialog', { name: 'b.png', exact: true }).locator('img')).toBeVisible();
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();

  await page.getByRole('treeitem', { name: 'b.png', exact: true }).press('Delete');
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: 'b.png', exact: true })).toHaveCount(0);
  await expect(cover).toHaveCount(0);
  const reopened = page.getByRole('region', { name: '资料属性', exact: true });
  await reopened.getByRole('button', { name: /^属性/ }).click();
  await expect(reopened.getByRole('combobox', { name: '封面', exact: true })).toHaveText('未设置');
});
