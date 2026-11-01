import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('relations');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

async function openResources() {
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
}

async function createResource(title: string) {
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建资料', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建文档', exact: true }).click();
}

async function choose(combobox: ReturnType<Page['getByRole']>, option: string) {
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test('资料页新建关系，事件列表穿插关系变化，重启后保留并按章判断是否持续', async () => {
  test.setTimeout(90_000);
  await workbench.createWork('长夜行');
  await workbench.createDocument('第一章', '林晚拜师。');
  await workbench.createDocument('第二章', '林晚出师。');
  await openResources();
  await createResource('顾长风');
  await createResource('林晚');

  const relations = page.getByRole('region', { name: '关系', exact: true });
  await relations.getByRole('button', { name: '添加关系', exact: true }).click();
  await choose(relations.getByRole('combobox', { name: '对方', exact: true }), '顾长风');
  await choose(relations.getByRole('combobox', { name: '关系类型', exact: true }), '师徒');
  await choose(relations.getByRole('combobox', { name: '本资料是', exact: true }), '徒弟');
  await expect(relations.getByRole('textbox', { name: '本资料的称呼', exact: true })).toHaveValue('徒弟');
  await expect(relations.getByRole('textbox', { name: '对方的称呼', exact: true })).toHaveValue('师父');
  await choose(relations.getByRole('combobox', { name: '发生在', exact: true }), '第一章');
  await relations.getByRole('button', { name: '结束', exact: true }).click();
  await choose(relations.getByRole('combobox', { name: '发生在', exact: true }).nth(1), '第二章');
  await relations.getByRole('button', { name: '保存', exact: true }).click();

  const row = relations.getByRole('button', { name: /^师父\s*顾长风/ });
  await expect(row).toContainText('《第一章》起 至《第二章》止');
  await expect(row).toContainText('已结束');
  const events = page.getByRole('region', { name: '事件', exact: true });
  await expect(events.getByText('成为顾长风的徒弟', { exact: true })).toBeVisible();
  await expect(events.getByText('与顾长风的师徒关系结束', { exact: true })).toBeVisible();

  await workbench.restart();
  page = workbench.page;
  await openResources();
  await page.getByRole('treeitem', { name: '林晚' }).click();
  await choose(page.getByRole('combobox', { name: '查看到', exact: true }), '第一章');
  const reopened = page.getByRole('region', { name: '关系', exact: true });
  const reopenedRow = reopened.getByRole('button', { name: /^师父\s*顾长风/ });
  await expect(reopenedRow).toContainText('持续');
  await expect(reopenedRow).not.toContainText('第二章');
  const reopenedEvents = page.getByRole('region', { name: '事件', exact: true });
  await expect(reopenedEvents.getByText('成为顾长风的徒弟', { exact: true })).toBeVisible();
  await expect(reopenedEvents.getByText('与顾长风的师徒关系结束', { exact: true })).toHaveCount(0);

  // 另一方资料页从自己的视角显示同一条关系。
  await page.getByRole('treeitem', { name: '顾长风' }).click();
  const masterRelations = page.getByRole('region', { name: '关系', exact: true });
  const masterRow = masterRelations.getByRole('button', { name: /^徒弟\s*林晚/ });
  await expect(masterRow).toBeVisible();

  // 删除关系进入作品回收站，恢复后照常显示。
  await masterRow.click();
  await masterRelations.getByRole('button', { name: '删除', exact: true }).click();
  await expect(masterRow).toHaveCount(0);
  const trash = page.getByRole('region', { name: '回收站', exact: true });
  await trash.getByRole('button', { name: /^回收站/ }).click();
  await expect(trash).toContainText('师徒：顾长风、林晚');
  await expect(trash).toContainText('关系 ·');
  await trash.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(masterRow).toBeVisible();
});
