import { expect, test, type Page } from '@playwright/test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;
let outside: string;
// 1×1 PNG。
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

test.beforeEach(async () => {
  workbench = await Workbench.start('illustrations');
  page = workbench.page;
  outside = await mkdtemp(path.join(tmpdir(), 'chaptale-illustrations-source-'));
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
  await rm(outside, { recursive: true, force: true });
});

function navigation() {
  return page.getByRole('complementary', { name: '作品导航' });
}
function section(name: '文稿' | '资料') {
  return page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name, exact: true }).click();
}

test('TXT 文稿右键插入插图先转为 Markdown；粘贴截图放进“插图”目录；阅读显示插图，删除图片后显示回收站提示', async () => {
  test.setTimeout(90_000);
  // 用有实际高度的图片，图片加载前后插图块高度变化明显。
  const tall = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 320;
    canvas.height = 480;
    canvas.getContext('2d')!.fillRect(0, 0, 320, 480);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await writeFile(path.join(outside, '城门.png'), Buffer.from(tall, 'base64'));
  await workbench.createWork('长夜行');
  await section('资料');
  await workbench.application.evaluate(
    ({ dialog }, selected) => {
      const original = dialog.showOpenDialog;
      dialog.showOpenDialog = async () => {
        dialog.showOpenDialog = original;
        return { canceled: false, filePaths: selected };
      };
    },
    [path.join(outside, '城门.png')]
  );
  await navigation().getByRole('button', { name: '作品操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '添加文件…', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '城门.png', exact: true })).toBeVisible();

  await section('文稿');
  await workbench.createDocument('第一章', '雨停了。');
  let body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '插入插图…', exact: true }).click();
  const picker = page.getByRole('dialog', { name: '插入插图', exact: true });
  await picker.getByRole('textbox', { name: '搜索图片', exact: true }).fill('城');
  await picker.getByRole('option', { name: /城门\.png/ }).click();
  const convert = page.getByRole('alertdialog');
  await expect(convert).toContainText('转为 Markdown 并插入插图？');
  await convert.getByRole('button', { name: '转为 Markdown 并插入', exact: true }).click();
  const gate = page.getByRole('figure', { name: '插图 城门', exact: true });
  await expect(gate.locator('img')).toBeVisible();
  await page.keyboard.insertText('灯火亮了。');
  // 单击图片打开预览。
  await gate.locator('img').click();
  await expect(page.getByRole('dialog', { name: '城门.png', exact: true }).locator('img')).toBeVisible();
  await page.getByRole('button', { name: '关闭预览', exact: true }).click();

  // 截图没有本机路径：按字节添加到资料根目录的“插图”目录后插入。
  await body.press('Control+End');
  await body.evaluate((element, data) => {
    const transfer = new DataTransfer();
    const bytes = Uint8Array.from(atob(data), char => char.charCodeAt(0));
    transfer.items.add(new File([bytes], '', { type: 'image/png' }));
    element.dispatchEvent(new ClipboardEvent('paste', { clipboardData: transfer, bubbles: true, cancelable: true }));
  }, png);
  await expect(page.getByRole('figure', { name: /^插图 粘贴的图片/ })).toBeVisible();
  await body.press('Control+s');
  await expect(page.getByRole('tab', { name: '第一章', exact: true })).toBeVisible();

  // 重启后首次打开带图文稿：插图之后的行号与当前行高亮都和正文行对齐。
  await workbench.restart();
  page = workbench.page;
  await page.getByRole('treeitem', { name: '第一章', exact: true }).click();
  await expect(page.getByRole('figure', { name: '插图 城门', exact: true }).locator('img')).toBeVisible();
  body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await expect
    .poll(() =>
      body.evaluate(element => {
        const editor = element.closest('.cm-editor')!;
        const lines = [...editor.querySelectorAll<HTMLElement>('.cm-content > .cm-line')];
        const numbers = [...editor.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')].filter(
          item => item.textContent
        );
        const text = lines.find(line => line.textContent === '灯火亮了。')!;
        const number = numbers.find(item => item.textContent === '3')!;
        return Math.abs(text.getBoundingClientRect().top - number.getBoundingClientRect().top);
      })
    )
    .toBeLessThan(2);

  await section('资料');
  // 添加后自动展开“插图”目录。
  await expect(page.getByRole('treeitem', { name: '插图', exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /^粘贴的图片.*\.png$/ })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /^粘贴的图片.*\.png$/ }).locator('img')).toBeVisible();

  await body.click();
  await body.press('Control+Home');
  await page.getByRole('button', { name: '阅读', exact: true }).click();
  const reading = page.getByRole('region', { name: '阅读：第一章' });
  await expect(reading.getByRole('figure', { name: '插图 城门', exact: true }).locator('img')).toBeVisible();
  await reading.getByRole('button', { name: '编辑', exact: true }).click();

  await page.getByRole('treeitem', { name: '城门.png', exact: true }).press('Delete');
  await page.getByRole('alertdialog').getByRole('button', { name: '删除', exact: true }).click();
  await expect(page.getByRole('figure', { name: '插图 城门', exact: true })).toContainText('图片在回收站中');
  const trash = page.getByRole('region', { name: '回收站', exact: true });
  await trash.getByRole('button', { name: /^回收站/ }).click();
  await expect(trash.locator('img')).toBeVisible();
});
