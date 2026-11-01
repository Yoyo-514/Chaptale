import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('story-sources');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

async function choose(combobox: ReturnType<Page['getByRole']>, option: string) {
  await combobox.click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

/** 在顾长风资料页添加一条出自第一章的事件，回到第一章。 */
async function prepare() {
  await workbench.createWork('长夜行');
  await workbench.createDocument('第一章', '顾长风守城。');
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建资料', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('顾长风');
  await page.getByRole('button', { name: '创建文档', exact: true }).click();

  const events = page.getByRole('region', { name: '事件', exact: true });
  await events.getByRole('button', { name: '添加事件', exact: true }).click();
  await events.getByRole('textbox', { name: '事件内容', exact: true }).fill('顾长风守城');
  await choose(events.getByRole('combobox', { name: '发生在', exact: true }), '第一章');
  await events.getByRole('button', { name: '更多', exact: true }).click();
  await choose(events.getByRole('combobox', { name: '出处', exact: true }), '第一章');
  await events.getByRole('button', { name: '保存', exact: true }).click();
  await expect(events.getByText('出自《第一章》')).toBeVisible();

  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '文稿', exact: true }).click();
  await page.getByRole('treeitem', { name: '第一章' }).click();
}

async function editChapter(text: string) {
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.click();
  await page.keyboard.press('End');
  await page.keyboard.insertText(text);
  await body.press('Control+s');
}

test('章节正文改过后提示核对，核对标签里确认后提醒消失，资料页标记跟随', async () => {
  test.setTimeout(90_000);
  await prepare();
  const chip = page.getByRole('button', { name: '本章 1 条记录待核对', exact: true });
  await expect(chip).toHaveCount(0);

  await editChapter('城破。');
  await expect(chip).toBeVisible();
  await chip.click();

  const pane = page.getByRole('region', { name: '核对', exact: true });
  await expect(pane.getByRole('heading', { name: '核对《第一章》' })).toBeVisible();
  await expect(pane.getByText('顾长风守城', { exact: true })).toBeVisible();
  await pane.getByRole('button', { name: '查看本章改动', exact: true }).click();
  await expect(page.getByRole('region', { name: '历史', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /核对.*第一章/ }).click();
  await pane.getByRole('button', { name: '本章记录仍适用', exact: true }).click();
  await expect(page.getByRole('tab', { name: /核对.*第一章/ })).toHaveCount(0);

  await page.getByRole('tab', { name: '第一章', exact: true }).click();
  await expect(chip).toHaveCount(0);

  await editChapter('援军至。');
  await expect(chip).toBeVisible();
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('treeitem', { name: '顾长风' }).click();
  await expect(page.getByRole('region', { name: '事件', exact: true }).getByText('《第一章》已改过')).toBeVisible();
});

test('删除来源章节时确认框写明影响，事件随章节进回收站，恢复后回来', async () => {
  test.setTimeout(90_000);
  await prepare();
  await page.getByRole('treeitem', { name: '第一章' }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '删除', exact: true }).click();
  const dialog = page.getByRole('alertdialog');
  await expect(dialog).toContainText('出自本章的 1 条事件随章节移入回收站');
  await dialog.getByRole('button', { name: '删除', exact: true }).click();

  const trash = page.getByRole('region', { name: '回收站', exact: true });
  await trash.getByRole('button', { name: /回收站/ }).click();
  await expect(trash.getByText('随章节：1 条事件')).toBeVisible();
  await trash.getByText('第一章', { exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '恢复', exact: true }).click();

  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('treeitem', { name: '顾长风' }).click();
  await expect(page.getByRole('region', { name: '事件', exact: true }).getByText('顾长风守城')).toBeVisible();
});
