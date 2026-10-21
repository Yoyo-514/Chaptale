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
  await writeFile(path.join(home, '.chaptale/settings.json'), JSON.stringify({ version: 1, workspace: {} }));
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
    await client.request('saveProvider', {
      id: 'electron-offline',
      config: {
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        models: [{ id: 'offline', name: '离线测试模型', contextWindow: 8192, maxTokens: 512 }]
      },
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

test('界面管理多个模型、直接聊天与切换会话，移动视图保留草稿，长指令可滚动', async () => {
  /** 标题即会话切换入口；其余会话操作在「更多」菜单里。 */
  async function switchSession(title: string) {
    await page.getByRole('button', { name: '切换会话', exact: true }).click();
    await page.getByRole('menuitem', { name: `查看${title}`, exact: true }).click();
  }
  async function sessionAction(name: string) {
    await page.getByRole('button', { name: '更多会话操作', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  await expect(page.getByRole('complementary', { name: '应用活动栏', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '会话', exact: true }).click();
  await page.getByRole('button', { name: '新建会话', exact: true }).click();
  await expect(page.getByLabel('消息', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '创建会话', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '配置模型', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByLabel('供应商标识', { exact: true }).fill('ui-offline');
  await settings.getByLabel('服务地址', { exact: true }).fill('http://127.0.0.1:9/v1');
  await settings.getByLabel('API 密钥', { exact: true }).fill('ui-offline-key');
  for (const [id, name] of [
    ['ui-model', '界面离线模型'],
    ['ui-model-two', '第二个离线模型']
  ]) {
    await settings.getByRole('button', { name: '手动添加', exact: true }).click();
    await settings.getByLabel('模型 ID', { exact: true }).fill(id);
    await settings.getByLabel('显示名称', { exact: true }).fill(name);
    await settings.getByLabel('上下文长度', { exact: true }).fill('8192');
    await settings.getByLabel('最大输出长度', { exact: true }).fill('512');
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('已保存');
  }
  const providers = await page.evaluate(() => window.chaptaleDesktop.agentHost.request('providers', undefined));
  expect(providers.flatMap(item => item.config.models?.map(model => model.id))).toEqual(['ui-model', 'ui-model-two']);
  expect(JSON.stringify(providers)).not.toContain('ui-offline-key');
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  // 用真实宿主建立空会话，避免在离线测试里向模型发请求。
  const ids = await page.evaluate(async () => {
    const client = window.chaptaleDesktop.agentHost;
    const model = { provider: 'ui-offline', id: 'ui-model' };
    return [await client.request('create', { model }), await client.request('create', { model })];
  });
  await switchSession('会话 1');
  await page.getByLabel('消息', { exact: true }).fill('保留这份草稿');
  await page.getByRole('combobox', { name: '修改模式', exact: true }).click();
  await page.getByRole('option', { name: '讨论', exact: true }).click();
  await sessionAction('移到主区');
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保留这份草稿');
  await expect(page.getByLabel('消息', { exact: true })).toHaveCount(1);
  await sessionAction('移到协作栏');
  await switchSession('会话 2');
  await page.getByLabel('消息', { exact: true }).fill('第二份独立草稿');
  await switchSession('会话 1');
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('保留这份草稿');
  await sessionAction('会话设置');
  await page.getByLabel('指令内容', { exact: true }).fill('只修改第一个会话的指令');
  await page.getByRole('button', { name: '保存当前会话指令', exact: true }).click();
  await expect
    .poll(async () => {
      const state = await page.evaluate(() => window.chaptaleDesktop.agentHost.request('state', undefined));
      return state.sessions.find(session => session.id === ids[0])?.instructions[0].text;
    })
    .toBe('只修改第一个会话的指令');
  const after = await page.evaluate(() => window.chaptaleDesktop.agentHost.request('state', undefined));
  expect(after.sessions.map(session => session.id)).toEqual(ids);
  expect(after.sessions[0].mode).toBe('discuss');
  expect(after.sessions[1].instructions[0].text).not.toBe('只修改第一个会话的指令');
  await page.getByRole('button', { name: '返回会话', exact: true }).click();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await settings.getByRole('button', { name: '写作指令', exact: true }).click();
  const long = '写作要求需要明确，重要决定先与作者确认。\n'.repeat(200);
  const editor = settings.getByLabel('指令内容', { exact: true });
  await editor.fill(long);
  expect(await editor.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);
  const save = settings.getByRole('button', { name: '保存新会话默认指令', exact: true });
  await save.click();
  await expect(settings.getByRole('status')).toContainText('已保存');
  const bounds = await settings.boundingBox();
  const action = await save.boundingBox();
  expect(action!.y + action!.height).toBeLessThanOrEqual(bounds!.y + bounds!.height);
  const evidence = path.resolve('temp/batch-b-ui');
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'instructions-wide.png') });
  await settings.getByRole('button', { name: '模型', exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'models-wide.png') });
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.screenshot({ path: path.join(evidence, 'workbench-wide.png') });
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  await page.screenshot({ path: path.join(evidence, 'workbench-narrow.png') });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await settings.getByRole('button', { name: '写作指令', exact: true }).click();
  await expect(settings.getByLabel('指令内容', { exact: true })).toHaveValue(long);
  await page.screenshot({ path: path.join(evidence, 'instructions-narrow.png') });
});

test('会话用量可用键盘查看，手动压缩走真实宿主且保留草稿', async () => {
  await page.getByRole('button', { name: '会话', exact: true }).click();
  await page.getByRole('button', { name: '更多会话操作', exact: true }).click();
  await expect(page.getByRole('menuitem', { name: '压缩对话', exact: true })).toBeDisabled();
  await page.keyboard.press('Escape');
  const state = await page.evaluate(async () => {
    const client = window.chaptaleDesktop.agentHost;
    await client.request('saveProvider', {
      id: 'usage-offline',
      apiKey: 'offline-usage-key',
      config: {
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        models: [{ id: 'offline', name: '离线用量模型', contextWindow: 100000, maxTokens: 512 }]
      }
    });
    return client.request('state', undefined);
  });
  const output = path.join(home, 'usage-fixture.json');
  await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `
    import { SessionManager } from '@earendil-works/pi-coding-agent';
    import { writeFile } from 'node:fs/promises';
    const [cwd, directory, output, instructions] = process.argv.slice(1);
    const manager = SessionManager.create(cwd, directory);
    manager.appendModelChange('usage-offline', 'offline');
    manager.appendCustomEntry('chaptale-agent-instructions', { entries: JSON.parse(instructions) });
    manager.appendCustomEntry('chaptale-edit-mode', { mode: 'review' });
    manager.appendMessage({ role: 'user', content: '用量验收历史', timestamp: Date.now() });
    manager.appendMessage({
      role: 'assistant', content: [{ type: 'text', text: '已有的创作讨论。' }],
      api: 'openai-completions', provider: 'usage-offline', model: 'offline',
      usage: { input: 20000, output: 4000, cacheRead: 8000, cacheWrite: 0, totalTokens: 32000,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
      stopReason: 'stop', timestamp: Date.now()
    });
    await writeFile(output, JSON.stringify({ file: manager.getSessionFile(), cwd }));
  `,
      state.cwd,
      path.join(home, '.chaptale/pi/sessions'),
      output,
      JSON.stringify(state.settings.defaultInstructions)
    ],
    { cwd: desktop }
  );
  const fixture = JSON.parse(await readFile(output, 'utf8')) as { file: string; cwd: string };
  await page.evaluate(input => window.chaptaleDesktop.agentHost.request('open', input), fixture);
  await page.getByRole('button', { name: '切换会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '查看用量验收历史', exact: true }).click();
  const usage = page.getByRole('button', { name: '会话用量', exact: true });
  await expect(usage).toHaveText('上下文约 32%');
  await usage.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog', { name: '会话用量', exact: true });
  await expect(details).toBeVisible();
  await expect(details).toHaveCSS('padding', '12px');
  await expect(details).not.toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
  await expect(details.locator('dd')).toHaveText(['20,000', '8,000', '0', '4,000', '32,000 / 100,000']);
  const evidence = path.resolve('temp/session-usage');
  await mkdir(evidence, { recursive: true });
  await page.screenshot({ path: path.join(evidence, 'usage-sidebar.png') });
  await page.keyboard.press('Escape');
  await expect(usage).toBeFocused();
  await page.getByLabel('消息', { exact: true }).fill('压缩操作保留草稿');
  await page.getByRole('button', { name: '更多会话操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '压缩对话', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('对话内容较少，暂时无需压缩');
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('压缩操作保留草稿');
  await expect(usage).toHaveText('上下文约 32%');
  await page.reload();
  await expect(usage).toHaveText('上下文约 32%');
  await page.getByRole('button', { name: '更多会话操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '移到主区', exact: true }).click();
  await usage.click();
  await expect(details).toBeVisible();
  await page.screenshot({ path: path.join(evidence, 'usage-main.png') });
  await page.keyboard.press('Escape');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  await usage.click();
  await expect(details).toBeVisible();
  const bounds = await details.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
  await page.screenshot({ path: path.join(evidence, 'usage-narrow.png') });
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
