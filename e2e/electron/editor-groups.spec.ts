import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('editor-groups');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(true);
});

test('向右拆分同文稿双开实时同步与跨栏撤销，目录侧边打开与关闭自动合并回单栏', async () => {
  test.setTimeout(90_000);
  await workbench.createWork('双栏纪事');
  await workbench.createDocument('第一章', '春风吹过山岗。\n马蹄声渐近。');
  await workbench.createDocument('第二章', '夜雨敲窗。');

  // 切到第一章并点击「向右拆分」：左右两组各自拥有独立标签栏，同文稿双开。
  await page.getByRole('tab', { name: '第一章', exact: true }).click();
  await page.getByRole('button', { name: '向右拆分', exact: true }).click();

  const leftGroup = page.getByRole('region', { name: '左侧编辑组' });
  const rightGroup = page.getByRole('region', { name: '右侧编辑组' });
  await expect(leftGroup.getByRole('tablist', { name: '左侧文档标签' })).toBeVisible();
  await expect(rightGroup.getByRole('tablist', { name: '右侧文档标签' })).toBeVisible();
  await expect(leftGroup.getByRole('tab', { name: '第一章', exact: true })).toBeVisible();
  await expect(rightGroup.getByRole('tab', { name: '第一章', exact: true })).toBeVisible();

  // 在左侧编辑正文，右侧同一章节实时更新且两侧标签均显示未保存状态。
  const leftEditor = leftGroup.getByRole('textbox', { name: '文档正文', exact: true });
  const rightEditor = rightGroup.getByRole('textbox', { name: '文档正文', exact: true });
  await leftEditor.click();
  await leftEditor.press('Control+Home');
  await page.keyboard.type('卷首语：');

  await expect(rightEditor).toContainText('卷首语：春风吹过山岗。');
  await expect(leftGroup.getByRole('tab', { name: '第一章（未保存）' })).toBeVisible();
  await expect(rightGroup.getByRole('tab', { name: '第一章（未保存）' })).toBeVisible();

  // 在右侧编辑器执行撤销，可跨栏撤销左侧刚才的输入，恢复干净状态。
  await rightEditor.click();
  while (
    (await rightEditor.innerText()).includes('卷首语') ||
    (await rightGroup.getByRole('tab', { name: '第一章（未保存）' }).count()) > 0
  ) {
    await rightEditor.press('Control+z');
  }
  await expect(leftEditor).toHaveText('春风吹过山岗。\n马蹄声渐近。', { useInnerText: true });
  await expect(rightEditor).toHaveText('春风吹过山岗。\n马蹄声渐近。', { useInnerText: true });

  // 在目录树右键「第二章」选择「在侧边打开」：当前焦点在右侧组，自动打开在左侧组。
  await page.getByRole('treeitem', { name: /第二章/ }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '在侧边打开', exact: true }).click();
  await expect(leftGroup.getByRole('tab', { name: '第二章', selected: true })).toBeVisible();

  // 关闭右侧组的唯一标签「第一章」，无需弹未保存确认（左侧仍开着），且右侧组自动合并回单栏。
  await rightGroup.getByRole('button', { name: '关闭 第一章', exact: true }).click();
  await expect(rightGroup).toHaveCount(0);
  await expect(page.getByRole('tablist', { name: '文档标签' })).toBeVisible();
  await expect(page.getByRole('tab', { name: '第一章', exact: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '第二章', selected: true })).toBeVisible();
});
