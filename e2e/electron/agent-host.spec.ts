import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

const desktop = path.resolve('apps/desktop');
const desktopRequire = createRequire(path.join(desktop, 'package.json'));
const executablePath = desktopRequire('electron') as string;
let application: ElectronApplication;
let page: Page;
let home: string;

test.beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'chaptale-host-e2e-'));
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    JSON.stringify({ version: 1, workspace: {}, onboarding: { completedVersion: 1 } })
  );
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as Record<string, string | undefined>).VITE_DEV_SERVER_URL;
  application = await electron.launch({
    executablePath,
    args: [desktop, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
});

test.afterEach(async () => {
  await application?.close();
  await rm(home, { recursive: true, force: true });
});

test('真实宿主保存模型、创建独立会话，刷新界面后读取同一快照，历史原件可重开', async () => {
  const result = await page.evaluate(async () => {
    const client = window.chaptaleDesktop.agentHost;
    const initial = await client.request('state', undefined);
    await client.request('configure', {
      provider: 'electron-offline',
      baseUrl: 'http://127.0.0.1:9/v1',
      api: 'openai-completions',
      modelId: 'offline',
      modelName: '离线测试模型',
      contextWindow: 8192,
      maxTokens: 512,
      reasoning: false,
      apiKey: 'electron-offline-key'
    });
    const first = await client.request('create', { model: { provider: 'electron-offline', id: 'offline' } });
    const second = await client.request('create', { model: { provider: 'electron-offline', id: 'offline' } });
    await client.request('instructions', {
      id: first,
      entries: [
        { name: '职责', role: 'system', enabled: true, text: '协助写作' },
        { name: '独立指令', role: 'user', enabled: true, text: '只用于第一个会话' }
      ]
    });
    await client.request('mode', { id: first, mode: 'discuss' });
    return { initial, first, second, state: await client.request('state', undefined) };
  });
  expect(result.initial.settings.defaultInstructions.map(entry => entry.name)).toEqual([
    '协作职责',
    '推进任务',
    '使用资料',
    '交流与交付'
  ]);
  expect(result.first).not.toBe(result.second);
  expect(result.state.sessions.find(session => session.id === result.first)).toMatchObject({
    mode: 'discuss',
    instructions: [{ text: '协助写作' }, { text: '只用于第一个会话' }]
  });
  expect(result.state.sessions.find(session => session.id === result.second)?.instructions).toEqual(
    result.initial.settings.defaultInstructions
  );
  await page.reload();
  const reconnected = await page.evaluate(() => window.chaptaleDesktop.agentHost.request('state', undefined));
  expect(reconnected.sessions.map(session => session.id)).toEqual([result.first, result.second]);
  // SDK 在有历史消息时持久化；用真实 SessionManager 创建历史，不向离线模型发请求。
  const fixtureFile = path.join(home, 'history-fixture.json');
  await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { SessionManager } from '@earendil-works/pi-coding-agent';
    import { writeFile } from 'node:fs/promises';
    const [cwd, directory, output, entries] = process.argv.slice(1);
    const manager = SessionManager.create(cwd, directory);
    manager.appendModelChange('electron-offline', 'offline');
    manager.appendThinkingLevelChange('off');
    manager.appendCustomEntry('chaptale-agent-instructions', { entries: JSON.parse(entries) });
    manager.appendCustomEntry('chaptale-edit-mode', { mode: 'discuss' });
    manager.appendMessage({ role: 'user', content: '已有历史正文', timestamp: Date.now() });
    await writeFile(output, JSON.stringify({ file: manager.getSessionFile(), id: manager.getSessionId() }));
  `,
      result.state.cwd,
      path.join(home, '.chaptale/pi/sessions'),
      fixtureFile,
      JSON.stringify(result.initial.settings.defaultInstructions)
    ],
    { cwd: desktop }
  );
  const fixture = JSON.parse(await readFile(fixtureFile, 'utf8')) as { file: string; id: string };
  const file = fixture.file;
  const original = await readFile(file, 'utf8');
  const reopened = await page.evaluate(
    async input => {
      const client = window.chaptaleDesktop.agentHost;
      const opened = await client.request('open', input);
      return { opened, state: await client.request('state', undefined) };
    },
    { file, cwd: result.state.cwd }
  );
  expect(reopened.opened).toBe(fixture.id);
  expect(reopened.state.sessions.find(session => session.id === reopened.opened)).toMatchObject({
    mode: 'discuss',
    messages: [{ role: 'user', text: '已有历史正文' }]
  });
  expect(await readFile(file, 'utf8')).toBe(original);
});

test('真实子进程退出会通知界面，重新连接只读快照', async () => {
  await page.evaluate(async () => {
    await window.chaptaleDesktop.agentHost.request('state', undefined);
    window.chaptaleDesktop.agentHost.onDisconnected(message => {
      document.body.dataset.hostExit = message;
    });
  });
  const pid = await application.evaluate(
    ({ app }) => app.getAppMetrics().find(process => process.name === 'Chaptale Agent')?.pid
  );
  expect(pid).toBeDefined();
  await application.evaluate((_electron, target) => process.kill(target!), pid);
  await expect.poll(() => page.evaluate(() => document.body.dataset.hostExit)).toContain('Agent 宿主已退出');
  const state = await page.evaluate(() => window.chaptaleDesktop.agentHost.request('state', undefined));
  expect(state.sessions).toEqual([]);
});
