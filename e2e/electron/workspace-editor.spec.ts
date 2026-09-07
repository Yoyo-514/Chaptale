import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const desktopRequire = createRequire(path.join(desktopDir, 'package.json'));
const electronExecutable = desktopRequire('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `t5-editor-${Date.now()}`);
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };

const chapter = '---\r\ntitle: 初雪\r\n---\r\n# 第一章\r\n\r\n雪落在窗沿，林晚收起了信。\r\n';
let app: ElectronApplication | undefined;
let page: Page;
let home: string;
let workspace: string;
let pageErrors: string[];

test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-editor-e2e-'));
  workspace = path.join(home, '青岚');
  await mkdir(path.join(workspace, '正文'), { recursive: true });
  await mkdir(path.join(workspace, '设定'));
  await writeFile(path.join(workspace, '正文/第一章.md'), chapter);
  await writeFile(path.join(workspace, '设定/第一章.md'), '设定中的同名文件');
  await writeFile(path.join(workspace, '损坏.md'), '---\ntitle: [坏的元数据\n---\n正文依然完整。');
  await writeFile(path.join(workspace, '空文件.txt'), '');
  await writeFile(path.join(workspace, '二进制.bin'), Buffer.from([0x50, 0x00, 0x4e]));
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.evaluate(async root => {
    await (window as DesktopWindow).chaptaleDesktop.settings.update({
      storage: { mode: 'workspace', workspacePath: root },
      theme: 'light'
    });
  }, workspace);
  await page.reload();
  await expect(page.getByRole('tree', { name: '工作区文件树' })).toBeVisible();
});

test.afterEach(async () => {
  const testInfo = test.info();
  try {
    if (testInfo.status !== testInfo.expectedStatus && page && !page.isClosed()) {
      await page.screenshot({ path: testInfo.outputPath('failure.png') });
    }
    await app?.close();
    app = undefined;
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home).startsWith('chaptale-editor-e2e-')).toBe(true);
    await rm(home, { recursive: true, force: true });
  }
  expect(pageErrors).toEqual([]);
});

async function openChapter(folder = '正文') {
  await page.getByRole('treeitem', { name: folder, exact: true }).click();
  await page.locator(`[data-tree-path="${folder}/第一章.md"]`).dblclick();
}

test('真实 preload 读取保留原文和哈希，并验证工作区身份及非法参数', async () => {
  const result = await page.evaluate(async rootPath => {
    const api = (window as DesktopWindow).chaptaleDesktop.workspace;
    const valid = await api.readDocument({ rootPath, relativePath: '正文/第一章.md' });
    const stale = await api.readDocument({ rootPath: `${rootPath}-old`, relativePath: '正文/第一章.md' });
    let invalid = '';
    try {
      await api.readDocument({ rootPath, relativePath: '../outside.md' });
    } catch (error) {
      invalid = String(error);
    }
    return { valid, stale, invalid };
  }, workspace);

  expect(result.valid).toMatchObject({
    ok: true,
    document: {
      content: chapter,
      sizeBytes: Buffer.byteLength(chapter),
      contentHash: createHash('sha256').update(chapter).digest('hex'),
      head: { status: 'ok', frontmatter: { title: '初雪' } }
    }
  });
  expect(result.stale).toMatchObject({ ok: false, code: 'workspace-changed' });
  expect(result.invalid).toContain('IPC 参数无效');
});

test('单击只选择，双击打开完整原文，编辑在保存前不写盘', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  const row = page.getByRole('treeitem', { name: '第一章.md', exact: true });
  await row.click();
  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveCount(0);
  await row.dblclick();

  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  const content = page.getByRole('textbox', { name: '文档正文' });
  await expect(content).toContainText('title: 初雪');
  await expect(content).toContainText('雪落在窗沿');
  await expect(content).toHaveAttribute('aria-readonly', 'false');
  await content.click();
  await page.keyboard.type('should-not-be-written');
  await expect(content).toContainText('should-not-be-written');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await page.keyboard.press('Control+z');
});

test('Ctrl+S 保留混合换行和 BOM，保存及标签切换不丢撤销', async () => {
  const raw = '\uFEFF---\r\ntitle: 初雪\r\n---\r\n第一行\r\n第二行\n第三行\r末尾';
  await writeFile(path.join(workspace, '正文/第一章.md'), raw);
  await openChapter();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('新增');
  await expect(page.getByText('未保存', { exact: true })).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(raw + '新增');
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).dblclick();
  await page.getByRole('tab', { name: '正文/第一章.md', exact: true }).click();
  await content.click();
  await page.keyboard.press('Control+z');
  await expect(content).not.toContainText('新增');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(raw);
});

test('关闭脏标签可以取消、保存后关闭，磁盘内容与作者选择一致', async () => {
  await openChapter();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('待保存的结尾');
  await page.getByRole('button', { name: '关闭 正文/第一章.md', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '保存未保存的修改？' });
  await expect(dialog).toContainText('正文/第一章.md');
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(content).toContainText('待保存的结尾');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await page.getByRole('button', { name: '关闭 正文/第一章.md', exact: true }).click();
  await dialog.getByRole('button', { name: '保存并继续' }).click();
  await expect(page.getByRole('tab', { name: '欢迎', exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter + '待保存的结尾');
});

test('磁盘冲突不覆盖任一方，重新读取需要显式放弃本地修改', async () => {
  await openChapter();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('本地结尾');
  await writeFile(path.join(workspace, '正文/第一章.md'), '外部的新正文');
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('alert')).toContainText('磁盘文件已更新');
  await expect(content).toContainText('本地结尾');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe('外部的新正文');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '不保存', exact: true }).click();
  await expect(content).toContainText('外部的新正文');
});

test('关闭工作区先保护脏缓冲，取消不改变工作区', async () => {
  await openChapter();
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('保留文字');
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '关闭工作区', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('保留文字');
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '关闭工作区', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '不保存', exact: true }).click();
  await expect(page.getByText('尚未打开工作区', { exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
});

test('自动保存由作者启用，暂停输入后写盘', async () => {
  await openChapter();
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitemcheckbox', { name: '自动保存', exact: true }).click();
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('自动保存结尾');
  await expect.poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter + '自动保存结尾');
});

test('新建章节使用自定义目录角色并立即打开', async () => {
  await writeFile(
    path.join(workspace, 'chaptale.json'),
    JSON.stringify({
      version: 1,
      id: 'book',
      title: '青岚',
      kind: 'novel',
      dirs: { manuscript: '稿件/第一卷' }
    })
  );
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建章节', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '章节目录' })).toHaveValue('稿件/第一卷');
  await page.getByRole('textbox', { name: '章节标题' }).fill('夜谈');
  await page.getByRole('button', { name: '创建章节', exact: true }).click();
  await expect(page.getByRole('tab', { name: '稿件/第一卷/0001-夜谈.md', exact: true })).toBeVisible();
  const created = await readFile(path.join(workspace, '稿件/第一卷/0001-夜谈.md'), 'utf8');
  expect(created).toContain('kind: chapter');
  expect(created).toContain('status: draft');
  expect(created).toContain('# 夜谈');
});

test('原生窗口关闭也受未保存保护，取消后仍能继续编辑', async () => {
  await openChapter();
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('窗口关闭保护');
  await app!.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]!.close();
  });
  const dialog = page.getByRole('dialog', { name: '保存未保存的修改？' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('窗口关闭保护');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter + '窗口关闭保护');
});

test('Enter 打开、重复打开聚焦、同名文件分开管理，关闭保持合理焦点', async () => {
  await openChapter();
  await page.getByRole('treeitem', { name: '第一章.md', exact: true }).press('Enter');
  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveCount(1);
  await openChapter('设定');
  await expect(page.getByRole('tab', { name: '设定/第一章.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: '正文/第一章.md', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('雪落在窗沿');
  await page.getByRole('button', { name: '关闭 设定/第一章.md', exact: true }).click();
  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '关闭 正文/第一章.md', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '欢迎', exact: true })).toBeVisible();
});

test('损坏元数据和空文件可打开，读取失败可在原标签重试', async () => {
  await page.getByRole('treeitem', { name: '损坏.md', exact: true }).dblclick();
  await expect(page.getByText('frontmatter 无法解析', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('title: [坏的元数据');
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).dblclick();
  await expect(page.getByText('空文件', { exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: '二进制.bin', exact: true }).dblclick();
  await expect(page.getByRole('alert')).toContainText('二进制文件');
  await writeFile(path.join(workspace, '二进制.bin'), '现在是 UTF-8 文本');
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('现在是 UTF-8 文本');
  await expect(page.getByRole('tab', { name: '二进制.bin', exact: true })).toHaveCount(1);
});

test('关闭工作区清空标签和正文', async () => {
  await openChapter();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toBeVisible();
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '关闭工作区', exact: true }).click();
  await expect(page.getByRole('tab', { name: '欢迎', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toHaveCount(0);
  await expect(page.getByText('尚未打开工作区', { exact: true })).toBeVisible();
});

test('HTML 作为源码显示，不执行脚本或加载文档中的远程图片', async () => {
  const raw = '<script>window.chaptaleUnsafeHtml = true</script>\n<img src="https://example.com/never-load.png">';
  await writeFile(path.join(workspace, '原文.html'), raw);
  const requests: string[] = [];
  page.on('request', request => {
    if (request.url().includes('never-load.png')) requests.push(request.url());
  });
  await page.getByRole('button', { name: '刷新文件树' }).click();
  await page.getByRole('treeitem', { name: '原文.html', exact: true }).dblclick();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('<script>');
  expect(await page.evaluate(() => 'chaptaleUnsafeHtml' in window)).toBe(false);
  expect(requests).toEqual([]);
});

test('读取尚未完成时关闭标签，迟到的结果不能重新打开文件', async () => {
  await writeFile(path.join(workspace, '在途.md'), Buffer.alloc(4 * 1024 * 1024, 'x'));
  await writeFile(path.join(workspace, '后续读取.txt'), Buffer.alloc(8 * 1024 * 1024, 'y'));
  await page.getByRole('button', { name: '刷新文件树' }).click();
  await expect(page.getByRole('treeitem', { name: '在途.md', exact: true })).toBeVisible();
  const closedWhileLoading = await page.evaluate(async rootPath => {
    document.querySelector('[data-tree-path="在途.md"]')!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await Promise.resolve();
    const wasLoading = document
      .querySelector('[aria-label="编辑器区域"] [role="status"]')
      ?.textContent?.includes('正在读取');
    document.querySelector<HTMLButtonElement>('[aria-label="关闭 在途.md"]')!.click();
    await (window as DesktopWindow).chaptaleDesktop.workspace.readDocument({ rootPath, relativePath: '后续读取.txt' });
    return wasLoading;
  }, workspace);
  expect(closedWhileLoading).toBe(true);
  await expect(page.getByRole('tab', { name: '在途.md', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '欢迎', exact: true })).toBeVisible();
});

test('标签切换恢复阅读位置，键盘可切换和关闭标签', async () => {
  await writeFile(path.join(workspace, '阅读.md'), '开头\n' + '下一段正文。\n'.repeat(5_000) + '阅读位置标记');
  await page.getByRole('button', { name: '刷新文件树' }).click();
  await page.getByRole('treeitem', { name: '阅读.md', exact: true }).dblclick();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await content.click();
  await page.keyboard.press('Control+End');
  await expect(content).toContainText('阅读位置标记');
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).dblclick();
  await expect(page.getByText('空文件', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '空文件.txt', exact: true }).focus();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('tab', { name: '阅读.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(content).toContainText('阅读位置标记');
  await content.click();
  await page.keyboard.press('Control+w');
  await expect(page.getByRole('tab', { name: '阅读.md', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '空文件.txt', exact: true })).toHaveAttribute('aria-selected', 'true');
});

test('两千文件只渲染可见行，Home/End 与父子导航保持焦点和 ARIA', async () => {
  test.setTimeout(60_000);
  for (let start = 0; start < 2_100; start += 100) {
    await Promise.all(
      Array.from({ length: 100 }, (_, offset) =>
        writeFile(path.join(workspace, `章-${String(start + offset).padStart(4, '0')}.md`), `正文 ${start + offset}`)
      )
    );
  }
  await page.getByRole('button', { name: '刷新文件树' }).click();
  const folder = page.getByRole('treeitem', { name: '设定', exact: true });
  await folder.focus();
  await page.keyboard.press('ArrowRight');
  await expect(folder).toHaveAttribute('aria-expanded', 'true');
  await page.keyboard.press('ArrowRight');
  const child = page.locator('[data-tree-path="设定/第一章.md"]');
  await expect(child).toBeFocused();
  await expect(child).toHaveAttribute('aria-setsize', '1');
  await expect(child).toHaveAttribute('aria-posinset', '1');
  await page.keyboard.press('ArrowLeft');
  await expect(folder).toBeFocused();
  await page.keyboard.press('End');
  const last = page.getByRole('treeitem', { name: '章-2099.md', exact: true });
  await expect(last).toBeFocused();
  expect(await page.getByRole('treeitem').count()).toBeLessThan(100);
  await page.keyboard.press('Enter');
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('正文 2099');
  await last.focus();
  await page.keyboard.press('Home');
  await expect(folder).toBeFocused();
});

test('100 MiB 文件必须显式选择大文件模式，能够跳到末尾且不截断', async () => {
  test.setTimeout(60_000);
  const bytes = Buffer.alloc(100 * 1024 * 1024, `${'x'.repeat(199)}\n`);
  const ending = '\nLARGE-FILE-END';
  bytes.write(ending, bytes.length - Buffer.byteLength(ending));
  await writeFile(path.join(workspace, '大文件.txt'), bytes);
  await page.getByRole('button', { name: '刷新文件树' }).click();
  await page.getByRole('treeitem', { name: '大文件.txt', exact: true }).dblclick();
  await expect(page.getByRole('alert')).toContainText('8 MiB');
  await expect(page.getByRole('textbox', { name: '文档正文' })).toHaveCount(0);
  const started = Date.now();
  await page.getByRole('button', { name: '以大文件模式打开', exact: true }).click();
  await expect(page.getByText('100.0 MiB', { exact: true })).toBeVisible({ timeout: 20_000 });
  const content = page.getByRole('textbox', { name: '文档正文' });
  await expect(content).toBeVisible();
  const openMs = Date.now() - started;
  await content.click();
  await page.keyboard.press('Control+End');
  await expect(content).toContainText('LARGE-FILE-END');
  expect(await page.locator('.cm-line').count()).toBeLessThan(150);
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'editor-100mib-end.png') });
  await writeFile(path.join(visualDir, 'large-file.json'), JSON.stringify({ sizeBytes: bytes.length, openMs }));
});

test('空目录有标记，目录读取失败可行内重试', async () => {
  await mkdir(path.join(workspace, '空目录'));
  await page.getByRole('button', { name: '刷新文件树' }).click();
  const empty = page.locator('[data-tree-path="空目录"]');
  await empty.click();
  await expect(empty.getByText('空', { exact: true })).toBeVisible();
  await rename(path.join(workspace, '设定'), path.join(home, 'moved'));
  await page.getByRole('treeitem', { name: '设定', exact: true }).click();
  const retry = page.getByRole('button', { name: '重新读取 设定', exact: true });
  await expect(retry).toBeVisible();
  await rename(path.join(home, 'moved'), path.join(workspace, '设定'));
  await retry.click();
  await expect(page.locator('[data-tree-path="设定/第一章.md"]')).toBeVisible();
  await expect(retry).toHaveCount(0);
});

test('三种主题下正文与搜索控件保持可见', async () => {
  await openChapter();
  await mkdir(visualDir, { recursive: true });
  for (const [label, className] of [
    ['暖色', 'theme-warm'],
    ['深色', 'dark'],
    ['浅色', 'theme-light']
  ] as const) {
    await page.getByRole('menuitem', { name: '视图', exact: true }).click();
    await page.getByRole('menuitem', { name: '外观', exact: true }).hover();
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(className));
    await page.getByRole('button', { name: '在文档中查找', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('雪落在窗沿');
    await expect(page.getByRole('textbox', { name: '查找', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(visualDir, `editor-${className}.png`) });
  }
});

for (const width of [1280, 1024]) {
  test(`${width} 窗口长文预览、查找与滚动不溢出`, async () => {
    const prefix = '# 长篇预览\n\n';
    const suffix = '\n全文结束标记';
    const text =
      prefix +
      '窗外的雪停了，林晚沿着旧路向前。\n\n'.repeat(6_000).slice(0, 100_000 - prefix.length - suffix.length) +
      suffix;
    await writeFile(path.join(workspace, '长文.md'), text);
    await app!.evaluate(({ BrowserWindow }, size) => {
      BrowserWindow.getAllWindows()[0]!.setSize(size, 720);
    }, width);
    await page.getByRole('button', { name: '刷新文件树' }).click();
    await page.getByRole('treeitem', { name: '长文.md', exact: true }).dblclick();
    const content = page.getByRole('textbox', { name: '文档正文' });
    await expect(content).toContainText('长篇预览');
    expect(await page.locator('.cm-line').count()).toBeLessThan(150);
    await mkdir(visualDir, { recursive: true });
    await page.screenshot({ path: path.join(visualDir, `editor-${width}-start.png`) });
    await content.click();
    await page.keyboard.press('Control+End');
    await expect(content).toContainText('全文结束标记');
    await page.getByRole('button', { name: '在文档中查找', exact: true }).click();
    await expect(page.locator('.cm-search input[name="search"]')).toBeVisible();
    await page.locator('.cm-search input[name="search"]').fill('全文结束标记');
    await page.locator('.cm-search input[name="search"]').press('Enter');
    await expect(page.locator('.cm-searchMatch-selected')).toHaveText('全文结束标记');
    await expect(page.locator('.cm-searchMatch-selected')).toBeVisible();
    const bounds = await page.evaluate(() => ({
      viewport: document.documentElement.clientWidth,
      document: document.documentElement.scrollWidth,
      editor: document.querySelector('[aria-label="编辑器区域"]')?.getBoundingClientRect().width
    }));
    expect(bounds.document).toBeLessThanOrEqual(bounds.viewport);
    expect(bounds.editor).toBeGreaterThan(300);
    await page.screenshot({ path: path.join(visualDir, `editor-${width}-end.png`) });
  });
}
