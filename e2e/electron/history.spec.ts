import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('history');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

async function rewrite(text: string, save = true) {
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.click();
  await body.press('Control+a');
  await page.keyboard.insertText(text);
  if (save) {
    await body.press('Control+s');
    await expect(page.getByRole('tab', { name: '雨夜', exact: true })).toBeVisible();
  }
}

test('多次保存 → 查看历史 → 对比 → 处理未保存输入后恢复 → 编辑区为旧版本', async () => {
  test.setTimeout(60_000);
  await workbench.createWork('长夜行');
  await workbench.createDocument('雨夜', '第一稿：雨停了。');
  await rewrite('第二稿：雨还在下。');
  await rewrite('第三稿：雪落下来。');
  await rewrite('没保存的草稿', false);

  await page.getByRole('tab', { name: '雨夜（未保存）', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查看历史', exact: true }).click();
  const versions = page.getByLabel('历史版本', { exact: true }).getByRole('button');
  // 新建文档时的空白正文也是一个版本。
  await expect(versions).toHaveCount(4);
  await expect(versions.first()).toContainText('当前版本');

  const diff = page.getByRole('region', { name: '版本对比', exact: true });
  // 从“与当前版本相同”切到紧邻的旧版本时，对比区要立即显示。
  await versions.first().click();
  await expect(page.getByRole('status').filter({ hasText: '与当前版本相同' })).toBeVisible();
  await versions.nth(1).click();
  await expect(diff).toContainText('第二稿：雨还在下。');

  await versions.nth(2).click();
  await expect(diff).toContainText('第一稿：雨停了。');
  await expect(diff).toContainText('第三稿：雪落下来。');

  await diff.getByRole('button', { name: '恢复此版本', exact: true }).click();
  await page.getByRole('button', { name: '不保存', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('第一稿：雨停了。');
  await expect(page.getByRole('tab', { name: '雨夜', exact: true })).toBeVisible();

  await page.getByRole('button', { name: '查看历史', exact: true }).click();
  await expect(versions).toHaveCount(5);
  // 仍选中恢复的旧版本，它与新的当前版本内容相同。
  await expect(page.getByRole('status').filter({ hasText: '与当前版本相同' })).toBeVisible();
  await expect(diff.getByRole('button', { name: '恢复此版本', exact: true })).toBeDisabled();
});
