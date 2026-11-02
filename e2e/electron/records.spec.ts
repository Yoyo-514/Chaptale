import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('records');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

async function openResources() {
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
}

async function addRecord(text: string, chapter: string, storyTime = '') {
  const events = page.getByRole('region', { name: '事件', exact: true });
  await events.getByRole('button', { name: '添加事件', exact: true }).click();
  await events.getByRole('combobox', { name: '发生在', exact: true }).click();
  await page.getByRole('option', { name: chapter, exact: true }).click();
  if (storyTime) await events.getByRole('textbox', { name: '故事时间', exact: true }).fill(storyTime);
  const content = events.getByRole('textbox', { name: '事件内容', exact: true });
  await content.fill(text);
  await content.press('Enter');
  await expect(events.getByText(text, { exact: true })).toBeVisible();
}

test('资料页逐条添加事件，按发生章节分组，重启后保留并可按章查看', async () => {
  test.setTimeout(90_000);
  await workbench.createWork('长夜行');
  await workbench.createDocument('第一章', '林晚入京。');
  await workbench.createDocument('第二章', '三年后，林晚离京。');
  await openResources();
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建资料', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('林晚');
  await page.getByRole('button', { name: '创建文档', exact: true }).click();

  await workbench.expandStory();
  await addRecord('林晚入京', '第一章');
  await addRecord('林晚离京', '第二章', '三年后');
  const events = page.getByRole('region', { name: '事件', exact: true });
  await expect(events.getByRole('heading', { name: '《第一章》', exact: true })).toBeVisible();
  await expect(events.getByRole('heading', { name: '《第二章》', exact: true })).toBeVisible();
  // 手写事件逐条保存，不进入资料标签的未保存状态。
  await expect(page.getByRole('tab', { name: '林晚', exact: true })).toBeVisible();

  await workbench.restart();
  page = workbench.page;
  await openResources();
  await page.getByRole('treeitem', { name: '林晚' }).click();
  await workbench.expandStory();
  const reopened = page.getByRole('region', { name: '事件', exact: true });
  await expect(reopened.getByText('林晚入京', { exact: true })).toBeVisible();
  await expect(reopened.getByText('三年后 · 作者补充', { exact: true })).toBeVisible();

  await page.getByRole('combobox', { name: '查看到', exact: true }).click();
  await page.getByRole('option', { name: '第一章', exact: true }).click();
  await expect(reopened.getByText('林晚入京', { exact: true })).toBeVisible();
  await expect(reopened.getByText('林晚离京', { exact: true })).toHaveCount(0);
});
