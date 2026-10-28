import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const desktop = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktop, 'package.json'))('electron') as string;
let application: ElectronApplication;
let page: Page;
let home: string;

async function launch() {
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as Record<string, string | undefined>).VITE_DEV_SERVER_URL;
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
  application = await electron.launch({
    executablePath,
    args: [desktop, `--user-data-dir=${path.join(home, 'profile')}`],
    env
  });
  page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
}

test.beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'chaptale-reading-'));
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(path.join(home, '.chaptale/settings.json'), JSON.stringify({ version: 1, workspace: {} }));
  await launch();
});

test.afterEach(async () => {
  // 用例结束时第二章仍未保存；直接销毁窗口，避免退出确认框阻塞清理。
  if (application?.process().exitCode === null)
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
  await application?.close();
  await rm(home, { recursive: true, force: true });
});

async function createDocument(title: string, text: string, save = true) {
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建文稿', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill(title);
  await page.getByRole('button', { name: '创建文档', exact: true }).click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.click();
  await page.keyboard.insertText(text);
  if (save) {
    await body.press('Control+s');
    await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible();
  }
}

test('编辑 → 阅读翻页 → 跨章与反向翻页 → 编辑读到的章节', async () => {
  test.setTimeout(120_000);
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByRole('textbox', { name: '作品名称', exact: true }).fill('长夜行');
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  const lines = Array.from({ length: 120 }, (_, index) => `第${index + 1}段，雨一直下，街灯一盏盏亮起来。`);
  await createDocument('第一章', lines.join('\n'));
  await createDocument('第二章', '天亮了。\n城门打开。', false);
  await createDocument('第三章', '尾声。');

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
