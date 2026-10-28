import { expect, test, type Page } from '@playwright/test';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('reading');
  page = workbench.page;
});

test.afterEach(async () => {
  // 用例结束时第二章仍未保存；直接销毁窗口，避免退出确认框阻塞清理。
  await workbench.dispose(true);
});

test('编辑 → 阅读翻页 → 跨章与反向翻页 → 编辑读到的章节', async () => {
  test.setTimeout(120_000);
  await workbench.createWork('长夜行');
  const lines = Array.from({ length: 120 }, (_, index) => `第${index + 1}段，雨一直下，街灯一盏盏亮起来。`);
  await workbench.createDocument('第一章', lines.join('\n'));
  await workbench.createDocument('第二章', '天亮了。\n城门打开。', false);
  await workbench.createDocument('第三章', '尾声。');

  // 阅读从光标所在位置开始。
  await page.getByRole('tab', { name: '第一章', exact: true }).click();
  await page.getByRole('textbox', { name: '文档正文', exact: true }).press('Control+Home');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  const reading = page.getByRole('region', { name: '阅读：第一章' });
  const status = page.getByRole('status').filter({ hasText: /^本章/ });
  await expect(status).toHaveText(/^本章 1 \/ \d+$/);
  const total = Number((await status.textContent())!.split('/ ')[1]);
  expect(total).toBeGreaterThan(1);
  await expect(reading).toContainText('第1段，');

  const viewport = page.getByLabel('阅读页', { exact: true });
  for (let index = 1; index < total; index++) await viewport.press('PageDown');
  await expect(status).toHaveText(`本章 ${total} / ${total}`);
  await expect(reading).toContainText('第120段，');

  // 第二章未保存，阅读显示编辑区当前文字。
  await viewport.press('ArrowRight');
  const second = page.getByRole('region', { name: '阅读：第二章' });
  await expect(second).toContainText('城门打开。');
  await expect(status).toHaveText('本章 1 / 1');
  await viewport.press('ArrowLeft');
  await expect(page.getByRole('region', { name: '阅读：第一章' })).toContainText('第120段，');
  await expect(status).toHaveText(`本章 ${total} / ${total}`);
  await viewport.press('ArrowRight');
  await second.getByRole('button', { name: '编辑', exact: true }).click();

  await expect(page.getByRole('tab', { name: '第二章（未保存）', selected: true })).toBeVisible();
  await expect(page.getByRole('tab', { name: '第一章', exact: true })).toBeVisible();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await expect(body).toHaveText('天亮了。\n城门打开。', { useInnerText: true });

  // 从第一章中间页切回编辑，光标落在该页第一段。
  await page.getByRole('tab', { name: '第一章', exact: true }).click();
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  await expect(status).toHaveText(`本章 1 / ${total}`);
  await viewport.press('PageDown');
  await viewport.press('PageDown');
  await expect(status).toHaveText(`本章 3 / ${total}`);
  const firstVisible = await page.evaluate(() => {
    const columns = document.querySelector<HTMLElement>('.reading-columns')!;
    const left = columns.parentElement!.getBoundingClientRect().left;
    const block = [...columns.querySelectorAll<HTMLElement>('[data-offset]')].find(item =>
      [...item.getClientRects()].some(rect => rect.left >= left - 1)
    )!;
    return block.textContent!;
  });
  await page.getByRole('region', { name: '阅读：第一章' }).getByRole('button', { name: '编辑', exact: true }).click();
  await page.keyboard.type('【');
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toContainText(`【${firstVisible}`);
});
