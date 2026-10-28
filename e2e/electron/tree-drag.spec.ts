import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('tree-drag');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

function titles() {
  return page.getByRole('tree', { name: '文稿目录' }).getByRole('treeitem').allInnerTexts();
}

test('拖动条目按插入线落到目标上方或下方，拖到目录中部放入目录', async () => {
  test.setTimeout(60_000);
  await workbench.createWork('长夜行');
  for (const title of ['甲', '乙', '丙']) await workbench.createDocument(title, `${title}的正文。`);
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建目录', exact: true }).click();
  await page.getByRole('textbox', { name: '目录名称', exact: true }).fill('卷一');
  await page.getByRole('button', { name: '创建目录', exact: true }).click();
  const item = (name: string) => page.getByRole('treeitem', { name, exact: true });
  await expect(item('卷一')).toBeVisible();

  // 丙拖到甲的上沿：排到甲之前。
  await item('丙').dragTo(item('甲'), { targetPosition: { x: 40, y: 3 } });
  await expect.poll(async () => (await titles()).map(text => text.split('\n')[0])).toEqual(['丙', '甲', '乙', '卷一']);
  // 丙拖到乙的下沿：排到乙之后。
  await item('丙').dragTo(item('乙'), { targetPosition: { x: 40, y: 30 } });
  await expect.poll(async () => (await titles()).map(text => text.split('\n')[0])).toEqual(['甲', '乙', '丙', '卷一']);
  // 甲拖到目录中部：放入目录。
  const box = (await item('卷一').boundingBox())!;
  await item('甲').dragTo(item('卷一'), { targetPosition: { x: 40, y: box.height / 2 } });
  await item('卷一').click();
  await expect(page.getByRole('treeitem', { name: '甲', exact: true })).toHaveAttribute('aria-level', '2');
});
