import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, readdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { CreationEvent, CreationResult } from '@chaptale/creation/contracts';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';

type DesktopWindow = typeof window & { chaptaleDesktop: ChaptaleDesktopApi };
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
  home = await mkdtemp(path.join(tmpdir(), 'chaptale-creation-bridge-'));
  await mkdir(path.join(home, '.chaptale/creation'), { recursive: true });
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    // 预先选定数据目录，跳过首次启动的位置选择页。
    JSON.stringify({ version: 1, workspace: {}, dataDir: path.join(home, '.chaptale/creation') })
  );
  await launch();
});

test.afterEach(async () => {
  // 失败现场已由 Playwright 留证；销毁临时测试窗口，避免未保存提示阻塞清理。
  if (test.info().status !== test.info().expectedStatus && application?.process().exitCode === null)
    await application.evaluate(({ BrowserWindow }) => {
      for (const window of BrowserWindow.getAllWindows()) window.destroy();
    });
  await application?.close();
  await rm(home, { recursive: true, force: true });
});

test('导出界面处理未保存修改，保留层级与卷标题，失败后保留选择并可重试', async () => {
  test.setTimeout(60_000);
  const output = path.join(home, '导出');
  const removed = path.join(home, '稍后移除');
  await mkdir(output);
  await mkdir(removed);
  await expect(page.getByRole('heading', { name: '作品库', exact: true })).toBeVisible();
  await page.evaluate(async () => {
    const api = (window as DesktopWindow).chaptaleDesktop.creation;
    const work = await api.request('createWork', { commandId: crypto.randomUUID(), title: '导出验证', kind: 'novel' });
    if (!work.ok) throw new Error(work.error.message);
    const folder = await api.request('createEntry', {
      commandId: crypto.randomUUID(),
      workId: work.value.id,
      parentId: null,
      section: 'manuscript',
      kind: 'directory',
      title: '卷/一'
    });
    if (!folder.ok) throw new Error(folder.error.message);
    const chapter = await api.request('createEntry', {
      commandId: crypto.randomUUID(),
      workId: work.value.id,
      parentId: folder.value.id,
      section: 'manuscript',
      kind: 'document',
      title: '章:一',
      format: 'txt',
      content: '原稿\r\n'
    });
    if (!chapter.ok) throw new Error(chapter.error.message);
  });
  await page.getByRole('button', { name: '导出验证', exact: true }).click();
  await page.getByRole('treeitem', { name: '卷/一', exact: true }).click();
  await page.getByRole('treeitem', { name: '章:一', exact: true }).click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('追加');
  await expect(page.getByRole('tab', { name: '章:一（未保存）', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '作品操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '导出正文…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '导出正文', exact: true });
  async function chooseDirectory(directory: string) {
    // 仅提供下一次系统目录选择结果；界面请求、存储与文件写入使用真实链路。
    await application.evaluate(({ dialog: nativeDialog }, selectedDirectory) => {
      const original = nativeDialog.showOpenDialog;
      nativeDialog.showOpenDialog = async () => {
        nativeDialog.showOpenDialog = original;
        return { canceled: false, filePaths: [selectedDirectory] };
      };
    }, directory);
    await dialog.getByRole('button', { name: '选择导出目录', exact: true }).click();
    await expect(dialog.getByText(directory, { exact: true })).toBeVisible();
  }
  await dialog.getByRole('combobox', { name: '导出范围', exact: true }).click();
  await page.getByRole('option', { name: '文稿分别导出', exact: true }).click();
  await chooseDirectory(output);
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: '保存未保存的修改？', exact: true });
  await unsaved.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog.getByRole('button', { name: '导出', exact: true })).toBeEnabled();
  expect(await readdir(output)).toEqual([]);
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  await expect(unsaved.getByText('章:一', { exact: true })).toBeVisible();
  await unsaved.getByRole('button', { name: '保存并继续', exact: true }).click();
  const chapterPath = path.join(output, '卷_一', '章_一.txt');
  await expect(dialog.getByText(chapterPath, { exact: true })).toBeVisible();
  expect(await readFile(chapterPath, 'utf8')).toBe('章:一\n\n原稿\r\n追加');

  await chooseDirectory(removed);
  await rm(removed, { recursive: true });
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('ENOENT');
  await expect(dialog.getByRole('combobox', { name: '导出范围', exact: true })).toContainText('文稿分别导出');
  await expect(dialog.getByRole('combobox', { name: '导出格式', exact: true })).toContainText('TXT');
  await expect(dialog.getByText(removed, { exact: true })).toBeVisible();
  await chooseDirectory(output);
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const retryPath = path.join(output, '卷_一 (2)', '章_一.txt');
  await expect(dialog.getByText(retryPath, { exact: true })).toBeVisible();
  expect(await readFile(retryPath, 'utf8')).toBe(await readFile(chapterPath, 'utf8'));

  await dialog.getByRole('combobox', { name: '导出范围', exact: true }).click();
  await page.getByRole('option', { name: '整本合并 TXT', exact: true }).click();
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const bookPath = path.join(output, '导出验证.txt');
  await expect(dialog.getByText(bookPath, { exact: true })).toBeVisible();
  expect(await readFile(bookPath, 'utf8')).toBe('卷/一\n\n章:一\n\n原稿\r\n追加');

  await dialog.getByRole('combobox', { name: '导出范围', exact: true }).click();
  await page.getByRole('option', { name: '当前文档', exact: true }).click();
  await dialog.getByRole('combobox', { name: '导出格式', exact: true }).click();
  await page.getByRole('option', { name: 'Markdown', exact: true }).click();
  await dialog.getByRole('button', { name: '导出', exact: true }).click();
  const singlePath = path.join(output, '章_一.md');
  await expect(dialog.getByText(singlePath, { exact: true })).toBeVisible();
  expect(await readFile(singlePath, 'utf8')).toBe('# 章:一\n\n原稿\r\n追加');
});

test('同名文稿切换、编辑、关闭与重启始终恢复对应正文', async () => {
  await expect(page.getByRole('heading', { name: '作品库', exact: true })).toBeVisible();
  const created = await page.evaluate(async () => {
    const api = (window as DesktopWindow).chaptaleDesktop.creation;
    const work = await api.request('createWork', { commandId: crypto.randomUUID(), title: '同名作品', kind: 'novel' });
    if (!work.ok) throw new Error(work.error.message);
    const ids: string[] = [];
    for (const content of ['第一份正文', '第二份正文']) {
      const entry = await api.request('createEntry', {
        commandId: crypto.randomUUID(),
        workId: work.value.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '同名',
        format: 'txt',
        content
      });
      if (!entry.ok) throw new Error(entry.error.message);
      ids.push(entry.value.id);
    }
    return { workId: work.value.id, secondId: ids[1] };
  });
  await page.getByRole('button', { name: '同名作品', exact: true }).click();
  const entries = page.getByRole('treeitem', { name: '同名', exact: true });
  await entries.nth(0).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('第一份正文');
  await entries.nth(1).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('第二份正文');
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  for (const index of [0, 1, 0, 1]) {
    await page.getByRole('tab', { name: '同名', exact: true }).nth(index).click();
    const content = index ? '第二份正文' : '第一份正文';
    await expect(body).toHaveText(content);
    await body.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.type('x');
    await expect(body).toHaveText(`${content}x`);
    await page.keyboard.press('Control+z');
    await expect(body).toHaveText(content);
  }
  await page.getByRole('tab', { name: '同名', exact: true }).nth(0).hover();
  await page.getByRole('button', { name: '关闭 同名', exact: true }).nth(0).click();
  await expect(page.getByRole('tab', { name: '同名', exact: true })).toHaveCount(1);
  await expect
    .poll(() =>
      page.evaluate(async workId => {
        const result = await (window as DesktopWindow).chaptaleDesktop.creation.request('readWorkbench', {});
        if (!result.ok) throw new Error(result.error.message);
        return result.value.works.find(work => work.workId === workId)?.tabs.map(tab => tab.documentId);
      }, created.workId)
    )
    .toEqual([created.secondId]);
  const tree = page.getByRole('tree', { name: '文稿目录', exact: true });
  const height = await tree.evaluate(element => element.clientHeight);
  await tree.click({ button: 'right', position: { x: 8, y: height - 8 } });
  await page.getByRole('menuitem', { name: '新建目录', exact: true }).click();
  await page.getByRole('textbox', { name: '目录名称', exact: true }).fill('新卷');
  await page.getByRole('button', { name: '创建目录', exact: true }).click();
  await expect(page.getByRole('treeitem', { name: '新卷', exact: true })).toHaveAttribute('aria-level', '1');
  await application.close();
  await launch();
  await expect(page.getByRole('tab', { name: '同名', exact: true })).toHaveCount(1);
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('第二份正文');
});

test('renderer 作品 API 保留保存结果与冲突，订阅可解除，重启后正文原样恢复', async () => {
  test.setTimeout(60_000);
  const result = await page.evaluate(async () => {
    const client = (window as DesktopWindow).chaptaleDesktop.creation;
    // evaluate 会序列化到 renderer，辅助函数必须在浏览器作用域内定义。
    function value<T>(response: CreationResult<T>): T {
      if (!response.ok) throw new Error(JSON.stringify(response.error));
      return response.value;
    }
    const events: CreationEvent[] = [];
    client.subscribe(event => {
      events.push(event);
      document.body.dataset.creationEvents = JSON.stringify(events);
    });
    document.body.dataset.removedEvents = '0';
    const stop = client.subscribe(() => {
      document.body.dataset.removedEvents = '1';
    });
    stop();
    const work = value(
      await client.request('createWork', { commandId: crypto.randomUUID(), title: '长夜行', kind: 'novel' })
    );
    const chapter = value(
      await client.request('createEntry', {
        commandId: crypto.randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '序章',
        format: 'txt',
        content: '原文'
      })
    );
    const input = {
      commandId: crypto.randomUUID(),
      workId: work.id,
      documentId: chapter.id,
      expectedRevisionId: chapter.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '第一行\r\n第二行\n'
    };
    const saved = value(await client.request('saveDocument', input));
    const conflict = await client.request('saveDocument', { ...input, commandId: crypto.randomUUID() });
    return { target: { workId: work.id, documentId: chapter.id }, revisionId: saved.revisionId, conflict };
  });
  expect(result.conflict).toMatchObject({
    ok: false,
    error: { code: 'revision-conflict', actualRevisionId: result.revisionId }
  });
  await expect.poll(() => page.evaluate(() => JSON.parse(document.body.dataset.creationEvents ?? '[]').length)).toBe(3);
  const events = JSON.parse(await page.evaluate(() => document.body.dataset.creationEvents!)) as CreationEvent[];
  expect(events.map(event => event.change.kind)).toEqual(['work', 'entry', 'entry']);
  expect(JSON.stringify(events)).not.toContain('第一行');
  expect(await page.evaluate(() => document.body.dataset.removedEvents)).toBe('0');
  await application.close();
  await launch();
  const reopened = await page.evaluate(
    target => (window as DesktopWindow).chaptaleDesktop.creation.request('readDocument', target),
    result.target
  );
  expect(reopened).toMatchObject({
    ok: true,
    value: { title: '雨夜', content: '第一行\r\n第二行\n', revisionId: result.revisionId }
  });
});

test('无效 renderer 参数与非可信页面请求在写入前被拒绝', async () => {
  const invalid = await page.evaluate(() =>
    (window as DesktopWindow).chaptaleDesktop.creation.request('createWork', {
      commandId: 'invalid',
      title: '越界输入',
      kind: 'novel',
      caller: 'author'
    } as never)
  );
  expect(invalid).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
  const rejected = await application.evaluate(
    async ({ BrowserWindow }, preload) => {
      const foreign = new BrowserWindow({
        show: false,
        webPreferences: { preload, sandbox: true, contextIsolation: true, nodeIntegration: false }
      });
      try {
        await foreign.loadURL('data:text/html,<html><body>untrusted</body></html>');
        return await foreign.webContents.executeJavaScript(`(async () => {
        try {
          await window.chaptaleDesktop.creation.request('createWork', { commandId: 'foreign', title: '非可信页面', kind: 'novel' });
          return { accepted: true };
        } catch (error) { return { accepted: false, message: error.message }; }
      })()`);
      } finally {
        foreign.destroy();
      }
    },
    path.join(desktop, 'dist/preload/index.mjs')
  );
  expect(rejected).toMatchObject({ accepted: false, message: expect.stringContaining('拒绝来自非可信页面') });
  const snapshot = await page.evaluate(() =>
    (window as DesktopWindow).chaptaleDesktop.creation.request('snapshot', { workId: null })
  );
  expect(snapshot).toMatchObject({ ok: true, value: { kind: 'library', works: [] } });
});

test('renderer 收到宿主断线后重取作品快照，原订阅继续接收新提交', async () => {
  const first = await page.evaluate(async () => {
    const client = (window as DesktopWindow).chaptaleDesktop.creation;
    let events = 0;
    client.subscribe(() => {
      document.body.dataset.creationCount = String(++events);
    });
    document.body.dataset.removedDisconnect = '0';
    const stop = client.onDisconnected(() => {
      document.body.dataset.removedDisconnect = '1';
    });
    stop();
    client.onDisconnected(message => {
      document.body.dataset.creationDisconnected = message;
    });
    return client.request('createWork', { commandId: 'first', title: '长夜行', kind: 'novel' });
  });
  expect(first).toMatchObject({ ok: true, value: { title: '长夜行' } });
  await expect.poll(() => page.evaluate(() => document.body.dataset.creationCount)).toBe('1');
  await application.evaluate(({ app }) => {
    const child = app.getAppMetrics().find(item => item.name === 'Chaptale Application');
    if (!child?.pid) throw new Error('业务进程尚未启动');
    process.kill(child.pid);
  });
  await expect.poll(() => page.evaluate(() => document.body.dataset.creationDisconnected)).toContain('应用宿主已退出');
  expect(await page.evaluate(() => document.body.dataset.removedDisconnect)).toBe('0');
  const snapshot = await page.evaluate(() =>
    (window as DesktopWindow).chaptaleDesktop.creation.request('snapshot', { workId: null })
  );
  expect(snapshot).toMatchObject({ ok: true, value: { kind: 'library', works: [{ title: '长夜行' }] } });
  const second = await page.evaluate(() =>
    (window as DesktopWindow).chaptaleDesktop.creation.request('createWork', {
      commandId: 'second',
      title: '新作',
      kind: 'script'
    })
  );
  expect(second).toMatchObject({ ok: true, value: { title: '新作' } });
  await expect.poll(() => page.evaluate(() => document.body.dataset.creationCount)).toBe('2');
});

test('renderer 预览并导入真实文件，导出保留原文和同名原件，重启后可重试同一计划', async () => {
  test.setTimeout(60_000);
  const source = path.join(home, '导入来源');
  const directory = path.join(home, '导出结果');
  await mkdir(source);
  await mkdir(directory);
  const body = '\uFEFF---\r\ntitle: 原标题\r\n---\r\n章节\r\n正文  \r\n';
  await writeFile(path.join(source, '章节.txt'), body);
  await writeFile(path.join(directory, '章节.txt'), '此前的导出');
  const result = await page.evaluate(
    async ({ source: sourcePath, directory: outputDirectory }) => {
      const client = (window as DesktopWindow).chaptaleDesktop.creation;
      // 辅助函数随 evaluate 一起进入浏览器执行。
      function value<T>(response: CreationResult<T>): T {
        if (!response.ok) throw new Error(response.error.message);
        return response.value;
      }
      const work = value(
        await client.request('createWork', { commandId: crypto.randomUUID(), title: '新作品', kind: 'novel' })
      );
      const plan = value(await client.request('prepareImport', { paths: [sourcePath] }));
      const before = value(await client.request('snapshot', { workId: work.id }));
      const input = { ...plan, workId: work.id, parentId: null, section: 'manuscript' as const };
      const imported = value(await client.request('importFiles', input));
      const exported = value(
        await client.request('exportFiles', {
          workId: work.id,
          directory: outputDirectory,
          target: { kind: 'manuscript', format: 'txt' }
        })
      );
      const book = value(
        await client.request('exportFiles', { workId: work.id, directory: outputDirectory, target: { kind: 'book' } })
      );
      return { before, input, imported, exported, book };
    },
    { source, directory }
  );
  expect(result.before).toMatchObject({ kind: 'work', entries: [] });
  expect(result.imported.failure).toBeNull();
  expect(result.imported.entries).toHaveLength(2);
  expect(result.exported).toEqual({ paths: [path.join(directory, '导入来源', '章节.txt')], failure: null });
  expect(result.book.failure).toBeNull();
  expect(await readFile(result.exported.paths[0]!, 'utf8')).toBe(`章节\n\n${body}`);
  expect(await readFile(result.book.paths[0]!, 'utf8')).toBe(`导入来源\n\n章节\n\n${body}`);
  expect(await readFile(path.join(directory, '章节.txt'), 'utf8')).toBe('此前的导出');
  expect(await readFile(path.join(source, '章节.txt'), 'utf8')).toBe(body);
  await expect(
    page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.creation.selectPaths('unknown' as never))
  ).rejects.toThrow('文件选择用途无效');
  await application.close();
  await launch();
  const retry = await page.evaluate(
    input => (window as DesktopWindow).chaptaleDesktop.creation.request('importFiles', input),
    result.input
  );
  expect(retry).toEqual({ ok: true, value: result.imported });
});

test('作品库界面完成新建、独立标题编辑、保存与重开恢复', async () => {
  test.setTimeout(60_000);
  await expect(page.getByRole('heading', { name: '作品库', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Agent 会话', exact: true })).toHaveCount(0);
  await expect(
    page.getByRole('contentinfo', { name: '状态栏' }).getByRole('button', { name: '作品库', exact: true })
  ).toHaveCount(0);
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByRole('textbox', { name: '作品名称', exact: true }).fill('长夜行');
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建文稿', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '文档格式', exact: true })).toHaveCount(0);
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('雨夜');
  await page.getByRole('button', { name: '创建文档', exact: true }).click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await expect(body).toBeVisible();
  await expect(page.getByRole('textbox', { name: '标题', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '保存', exact: true })).toHaveCount(0);
  await body.click();
  await expect(body).toBeFocused();
  await page.keyboard.type('雨停了。');
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('Alice望向街道。');
  await expect(page.getByRole('tab', { name: '雨夜（未保存）', exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: '雨夜', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('破晓');
  await page.getByRole('button', { name: '确认', exact: true }).click();
  await expect(page.getByRole('tab', { name: '破晓（未保存）', exact: true })).toBeVisible();
  await body.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '查找', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '查找', exact: true })).toBeFocused();
  await page.getByRole('textbox', { name: '查找', exact: true }).fill('Alice');
  await page.keyboard.press('Escape');
  await body.press('Control+s');
  await expect(page.getByRole('tab', { name: '破晓', exact: true })).toBeVisible();
  await expect(page.getByRole('treeitem', { name: /破晓/ })).toContainText('8 字');
  await expect(page.getByRole('status').filter({ hasText: /^(已保存|未保存)$/ })).toHaveCount(0);
  await body.press('Control+f');
  await expect(page.getByRole('textbox', { name: '查找', exact: true })).toBeFocused();
  await page.keyboard.press('Escape');
  await body.press('Control+h');
  await expect(page.getByRole('textbox', { name: '替换', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await body.press('End');
  await body.press('x');
  await expect(page.getByRole('tab', { name: '破晓（未保存）', exact: true })).toBeVisible();
  await body.press('Control+z');
  await expect(page.getByRole('tab', { name: '破晓', exact: true })).toBeVisible();
  await body.press('Shift+F10');
  await expect(page.getByRole('menuitem', { name: '查找', exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(body).toBeFocused();
  await application.close();
  await launch();
  await expect(page.getByRole('tab', { name: '破晓', exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveText('雨停了。\n\nAlice望向街道。', {
    useInnerText: true
  });
  await page.getByRole('menubar').getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '作品库', exact: true }).click();
  await expect(page.getByRole('button', { name: '返回 长夜行', exact: true })).toHaveCount(0);
  await page
    .getByRole('row')
    .filter({ has: page.getByRole('button', { name: '长夜行', exact: true }) })
    .getByRole('cell', { name: '小说', exact: true })
    .click();
  await expect(page.getByRole('tab', { name: '破晓', exact: true })).toBeVisible();
});
