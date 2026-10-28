import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('attributes');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

test('资料类型、别名与标签随正文保存，重启后保留', async () => {
  test.setTimeout(60_000);
  await workbench.createWork('长夜行');
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建资料', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('林晚');
  await page.getByRole('button', { name: '创建文档', exact: true }).click();

  const panel = page.getByRole('region', { name: '资料属性', exact: true });
  await panel.getByRole('button', { name: /^属性/ }).click();
  await panel.getByRole('combobox', { name: '类型', exact: true }).fill('人物');
  const alias = panel.getByRole('textbox', { name: '添加别名', exact: true });
  await alias.fill('小林');
  await alias.press('Enter');
  await expect(panel.getByText('小林', { exact: true })).toBeVisible();
  const tag = panel.getByRole('textbox', { name: '添加标签', exact: true });
  await tag.fill('主角');
  await tag.press('Enter');
  await panel.getByRole('button', { name: '移除别名小林', exact: true }).click();
  await alias.fill('阿晚');
  await alias.press('Enter');
  await expect(page.getByRole('tab', { name: '林晚（未保存）', exact: true })).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { name: '林晚', exact: true })).toBeVisible();

  await workbench.restart();
  page = workbench.page;
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('treeitem', { name: '林晚' }).click();
  const reopened = page.getByRole('region', { name: '资料属性', exact: true });
  // 折叠时摘要显示类型与标签。
  await expect(reopened.getByRole('button', { name: '属性 人物，别名 阿晚，标签 主角', exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: /^属性/ }).click();
  await expect(reopened.getByRole('combobox', { name: '类型', exact: true })).toHaveValue('人物');
  await expect(reopened.getByText('阿晚', { exact: true })).toBeVisible();
  await expect(reopened.getByText('主角', { exact: true })).toBeVisible();
  await expect(reopened.getByText('小林', { exact: true })).toHaveCount(0);
});
