import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
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
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(path.join(home, '.chaptale/settings.json'), JSON.stringify({ version: 1, workspace: {} }));
  await launch();
});

test.afterEach(async () => {
  await application?.close();
  await rm(home, { recursive: true, force: true });
});

test('renderer 作品 API 保留保存结果与冲突，订阅可解除，重启后正文原样恢复', async () => {
  test.setTimeout(60_000);
  const result = await page.evaluate(async () => {
    const client = (window as DesktopWindow).chaptaleDesktop.creation;
    // evaluate 会序列化到 renderer，辅助函数必须在浏览器作用域内定义。
    // oxlint-disable-next-line unicorn/consistent-function-scoping
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
      // oxlint-disable-next-line unicorn/consistent-function-scoping
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
  expect(result.exported).toEqual({ paths: [path.join(directory, '章节 (2).txt')], failure: null });
  expect(result.book.failure).toBeNull();
  expect(await readFile(result.exported.paths[0]!, 'utf8')).toBe(`章节\n\n${body}`);
  expect(await readFile(result.book.paths[0]!, 'utf8')).toBe(`章节\n\n${body}`);
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
