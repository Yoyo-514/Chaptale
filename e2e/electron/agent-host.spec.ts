import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
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
  await mkdir(path.join(home, '.chaptale/creation'), { recursive: true });
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    // 预先选定数据目录，跳过首次启动的位置选择页。
    JSON.stringify({ version: 1, workspace: {}, dataDir: path.join(home, '.chaptale/creation') })
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

/** 协作栏属于作品视图；移动会话视图的用例先打开一部作品。 */
async function createWork() {
  await page.getByRole('button', { name: '新建作品', exact: true }).click();
  await page.getByRole('textbox', { name: '作品名称', exact: true }).fill('长夜行');
  await page.getByRole('button', { name: '创建作品', exact: true }).click();
  await expect(page.getByRole('complementary', { name: '作品导航' })).toBeVisible();
}

/** 唯一作品的 ID；用例把会话直接建在作品里。 */
async function onlyWork(): Promise<string> {
  return page.evaluate(async () => {
    const works = await window.chaptaleDesktop.creation.request('listWorks', {});
    if (!works.ok) throw new Error(works.error.message);
    return works.value[0]!.id;
  });
}

/** 刷新后界面按归属列出宿主里的会话。 */
async function reloadSessions() {
  await page.reload();
  await openSessions();
}

/** 会话入口在标题栏菜单「会话」中。 */
async function openSessions() {
  await page.getByRole('menubar').getByRole('menuitem', { name: '会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建会话', exact: true }).click();
}

test.afterEach(async () => {
  await application?.close();
  await rm(home, { recursive: true, force: true });
});

test('未保存修改先提示保存再发送，附带当前标签与选区并在重开后保留标记', async () => {
  const requests: string[] = [];
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  // 本地端点仅捕获请求并返回错误，不生成模型回复。
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on('data', chunk => chunks.push(Buffer.from(chunk)));
    request.on('end', () => {
      requests.push(Buffer.concat(chunks).toString('utf8'));
      response.writeHead(400, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ error: { message: '离线捕获结束' } }));
      markStarted();
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as { port: number };
  try {
    await createWork();
    await openSessions();
    await page
      .getByRole('complementary', { name: '作品导航' })
      .getByRole('button', { name: '作品操作', exact: true })
      .click();
    await page.getByRole('menuitem', { name: '新建文稿', exact: true }).click();
    await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('第三回');
    await page.getByRole('button', { name: '创建文档', exact: true }).click();
    const body = page.getByRole('textbox', { name: '文档正文', exact: true });
    await body.click();
    await page.keyboard.insertText('这句需要润色\n未选中的完整稿件内容');
    await body.press('Control+Home');
    await body.press('Shift+End');
    await page.evaluate(async localPort => {
      await window.chaptaleDesktop.agentHost.request('saveProvider', {
        id: 'editor-context-local',
        apiKey: 'offline-local',
        config: {
          baseUrl: `http://127.0.0.1:${localPort}/v1`,
          api: 'openai-completions',
          models: [{ id: 'capture', name: '离线编辑快照', contextWindow: 8192, maxTokens: 512 }]
        }
      });
    }, port);
    await page.getByLabel('会话模型', { exact: true }).click();
    await page.getByRole('option', { name: '离线编辑快照', exact: true }).click();
    await page.getByLabel('消息', { exact: true }).fill('润色选中的句子');
    await page.getByRole('button', { name: '发送', exact: true }).click();
    const unsaved = page.getByRole('dialog', { name: '保存未保存的修改？', exact: true });
    await expect(unsaved).toBeVisible();
    await unsaved.getByRole('button', { name: '保存并继续', exact: true }).click();
    await started;
    await expect(page.getByRole('button', { name: '发送', exact: true })).toBeVisible();
    expect(requests.join('\n')).toContain('当前打开：文稿《第三回》');
    expect(requests.join('\n')).toContain('这句需要润色');
    expect(requests.join('\n')).not.toContain('未选中的完整稿件内容');
    const sent = await page.evaluate(async () => {
      const state = await window.chaptaleDesktop.agentHost.request('state', undefined);
      const session = state.sessions[0];
      return {
        id: session.id,
        file: session.file,
        context: session.messages.find(message => message.role === 'user')!.editorContext
      };
    });
    expect(sent.context).toMatchObject({ title: '第三回', section: 'manuscript', selection: '这句需要润色' });
    await expect(page.locator('.agent-user [aria-label="编辑上下文"]')).toContainText('文稿《第三回》选区');
    await expect(page.getByRole('tab', { name: '第三回', exact: true })).toBeVisible();

    // 编辑器右键“引用到对话”聚焦输入框并挂上待发选区芯片。
    await body.click();
    await body.press('Control+End');
    await body.press('Shift+Home');
    await body.press('Shift+F10');
    await page.getByRole('menuitem', { name: '引用到对话', exact: true }).click();
    await expect(page.getByRole('group', { name: '文稿《第三回》选区', exact: true })).toContainText(
      '未选中的完整稿件内容'
    );
    await expect(page.getByLabel('消息', { exact: true })).toBeFocused();
    await page.getByRole('button', { name: '移除引用', exact: true }).click();
    await expect(page.getByRole('group', { name: '文稿《第三回》选区', exact: true })).toHaveCount(0);

    // 编辑历史消息原地分叉并可通过分支切换器切回旧分支，重开历史后保留。
    const nextRequest = new Promise<void>(resolve => {
      markStarted = resolve;
    });
    await page.locator('.agent-user').hover();
    await page.getByRole('button', { name: '编辑消息', exact: true }).click();
    await page.getByLabel('编辑消息', { exact: true }).fill('改用冷峻语气润色');
    await page.locator('.agent-user-edit-actions').getByRole('button', { name: '发送', exact: true }).click();
    await nextRequest;
    await expect(page.getByRole('group', { name: '分支切换', exact: true })).toContainText('2 / 2');
    await expect(page.locator('.agent-user-text')).toHaveText('改用冷峻语气润色');

    await page.getByRole('button', { name: '上一分支', exact: true }).click();
    await expect(page.getByRole('group', { name: '分支切换', exact: true })).toContainText('1 / 2');
    await expect(page.locator('.agent-user-text')).toHaveText('润色选中的句子');

    const reopened = await page.evaluate(async ({ id, file }) => {
      const client = window.chaptaleDesktop.agentHost;
      await client.request('close', { id });
      const opened = await client.request('open', { file });
      const state = await client.request('state', undefined);
      const user = state.sessions
        .find(session => session.id === opened)!
        .messages.find(message => message.role === 'user')!;
      return { context: user.editorContext, text: user.text, branch: user.branch };
    }, sent);
    expect(reopened.context).toEqual(sent.context);
    expect(reopened.text).toBe('润色选中的句子');
    expect(reopened.branch).toMatchObject({ index: 1, total: 2 });
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
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
    const first = await client.request('create', {
      model: { provider: 'electron-offline', id: 'offline' },
      workId: null
    });
    const second = await client.request('create', {
      model: { provider: 'electron-offline', id: 'offline' },
      workId: null
    });
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
  // 重载后桥接对象随新页面重新注入，先等它出现再请求。
  await page.waitForFunction(() => 'chaptaleDesktop' in window);
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
      home,
      path.join(home, '.chaptale/creation/sessions/unassigned'),
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
    { file }
  );
  expect(reopened.opened).toBe(fixture.id);
  expect(reopened.state.sessions.find(session => session.id === reopened.opened)).toMatchObject({
    mode: 'discuss',
    messages: [{ role: 'user', text: '已有历史正文' }]
  });
  expect(await readFile(file, 'utf8')).toBe(original);
});

test('界面管理多个模型、直接聊天与切换会话，各会话草稿独立，长指令可滚动', async () => {
  await createWork();
  /** 标题即会话切换入口；其余会话操作在「更多」菜单里。 */
  async function switchSession(title: string) {
    await page.getByRole('button', { name: '切换会话', exact: true }).click();
    await page.getByRole('menuitem', { name: `查看${title}`, exact: true }).click();
  }
  async function sessionAction(name: string) {
    await page.getByRole('button', { name: '更多会话操作', exact: true }).click();
    await page.getByRole('menuitem', { name, exact: true }).click();
  }
  await openSessions();
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
  const ids = await page.evaluate(
    async workId => {
      const client = window.chaptaleDesktop.agentHost;
      const model = { provider: 'ui-offline', id: 'ui-model' };
      const created = [
        await client.request('create', { model, workId }),
        await client.request('create', { model, workId })
      ];
      await client.request('rename', { id: created[0]!, name: '会话 1' });
      await client.request('rename', { id: created[1]!, name: '会话 2' });
      return created;
    },
    await onlyWork()
  );
  await reloadSessions();
  await switchSession('会话 1');
  await page.getByLabel('消息', { exact: true }).fill('保留这份草稿');
  await page.getByRole('combobox', { name: '修改模式', exact: true }).click();
  await page.getByRole('option', { name: '讨论', exact: true }).click();
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
  await settings.getByRole('button', { name: '模型', exact: true }).click();
  await settings.getByRole('button', { name: '关闭设置', exact: true }).click();
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await settings.getByRole('button', { name: '写作指令', exact: true }).click();
  await expect(settings.getByLabel('指令内容', { exact: true })).toHaveValue(long);
});

test('禁用的按钮悬停时仍显示说明', async () => {
  await createWork();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  const settings = page.getByRole('dialog');
  await settings.getByRole('button', { name: '写作指令', exact: true }).click();
  // 只有一条指令时不能上移。
  const up = settings.getByRole('button', { name: '上移指令', exact: true });
  await expect(up).toBeDisabled();
  const box = (await up.boundingBox())!;
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole('tooltip')).toHaveText('上移指令');
});

test('会话用量可用键盘查看，手动压缩走真实宿主且保留草稿', async () => {
  await createWork();
  await openSessions();
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
    await writeFile(output, JSON.stringify({ file: manager.getSessionFile() }));
  `,
      home,
      path.join(home, '.chaptale/creation/sessions', await onlyWork()),
      output,
      JSON.stringify(state.settings.defaultInstructions)
    ],
    { cwd: desktop }
  );
  const fixture = JSON.parse(await readFile(output, 'utf8')) as { file: string };
  await page.evaluate(input => window.chaptaleDesktop.agentHost.request('open', input), fixture);
  await reloadSessions();
  await page.getByRole('button', { name: '切换会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '查看用量验收历史', exact: true }).click();
  const usage = page.getByRole('button', { name: '会话用量', exact: true });
  await expect(usage).toHaveText('上下文约 32%');
  await usage.focus();
  await page.keyboard.press('Enter');
  const details = page.getByRole('dialog', { name: '会话用量', exact: true });
  await expect(details).toBeVisible();
  await expect(details.locator('dd')).toHaveText(['20,000', '8,000', '0', '4,000', '32,000 / 100,000']);
  await page.keyboard.press('Escape');
  await expect(usage).toBeFocused();
  await page.getByLabel('消息', { exact: true }).fill('压缩操作保留草稿');
  await page.getByRole('button', { name: '更多会话操作', exact: true }).click();
  await page.getByRole('menuitem', { name: '压缩对话', exact: true }).click();
  // 无需压缩是一条普通提示，不按错误播报。
  await expect(page.getByRole('status').filter({ hasText: '对话内容较少，暂时无需压缩' })).toBeVisible();
  await expect(page.getByLabel('消息', { exact: true })).toHaveValue('压缩操作保留草稿');
  await expect(usage).toHaveText('上下文约 32%');
  // 刷新后回到作品库，从会话菜单重新打开同一会话。
  await page.reload();
  await openSessions();
  await page.getByRole('button', { name: '切换会话', exact: true }).click();
  await page.getByRole('menuitem', { name: '查看用量验收历史', exact: true }).click();
  await expect(usage).toHaveText('上下文约 32%');
  await usage.click();
  await expect(details).toBeVisible();
  await page.keyboard.press('Escape');
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
  await usage.click();
  await expect(details).toBeVisible();
  const bounds = await details.boundingBox();
  const viewport = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(viewport.width);
  expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(viewport.height);
});

test('生成时停止原位替换发送，快捷键插话不另起请求且停止后保留草稿', async () => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  let requests = 0;
  // 本地端点只挂起请求，供取消测试使用，不返回生成内容。
  const server = createServer((request, response) => {
    requests++;
    request.resume();
    response.writeHead(200, { 'Content-Type': 'text/event-stream' });
    response.flushHeaders();
    markStarted();
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    await createWork();
    await page.evaluate(
      async ({ port, workId }) => {
        const host = window.chaptaleDesktop.agentHost;
        await host.request('saveProvider', {
          id: 'pending-local',
          apiKey: 'offline-test',
          config: {
            baseUrl: `http://127.0.0.1:${port}/v1`,
            api: 'openai-completions',
            models: [{ id: 'pending', name: '本地挂起请求', contextWindow: 8192, maxTokens: 512 }]
          }
        });
        await host.request('create', { model: { provider: 'pending-local', id: 'pending' }, workId });
      },
      { port: address.port, workId: await onlyWork() }
    );
    await reloadSessions();
    await page.getByRole('button', { name: '切换会话', exact: true }).click();
    await page.getByRole('menuitem', { name: '查看未命名会话', exact: true }).click();
    const input = page.getByLabel('消息', { exact: true });
    const send = page.getByRole('button', { name: '发送', exact: true });
    const stop = page.getByRole('button', { name: '停止生成', exact: true });
    await input.fill('开始讨论');
    const before = await send.boundingBox();
    await send.click();
    await started;
    await expect(stop).toBeVisible();
    await expect(send).toHaveCount(0);
    const during = await stop.boundingBox();
    expect(Math.abs(before!.x - during!.x)).toBeLessThan(1);
    expect(Math.abs(before!.width - during!.width)).toBeLessThan(1);
    await input.fill('补充写作要求');
    await input.press('Enter');
    await expect(input).toHaveValue('');
    expect(requests).toBe(1);
    await input.fill('停止后保留的草稿');
    await stop.click();
    await expect(send).toBeVisible();
    await expect(stop).toHaveCount(0);
    await expect(input).toHaveValue('停止后保留的草稿');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});

test('拉取大量模型后在搜索多选下拉中确认添加，收起保留勾选且不提前保存', async () => {
  // 只提供模型目录元数据；本用例不处理对话或伪造模型回复。
  const server = createServer((_request, response) => {
    response.setHeader('Content-Type', 'application/json');
    response.end(
      JSON.stringify({
        data: Array.from({ length: 450 }, (_, i) => {
          const suffix = String(i).padStart(3, '0');
          return { id: `model-${suffix}`, displayName: `推荐模型${suffix}` };
        })
      })
    );
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as { port: number };
  try {
    await createWork();
    await openSessions();
    await page.getByRole('button', { name: '配置模型', exact: true }).click();
    const settings = page.getByRole('dialog');
    await settings.getByLabel('供应商标识', { exact: true }).fill('model-directory');
    await settings.getByLabel('服务地址', { exact: true }).fill(`http://127.0.0.1:${address.port}/v1`);
    await settings.getByRole('button', { name: '拉取模型列表', exact: true }).click();
    const search = page.getByPlaceholder('搜索模型名称或 ID…', { exact: true });
    await expect(search).toBeVisible();
    await expect(search).toBeFocused();
    await search.fill('model-449');
    await expect(page.getByRole('option')).toHaveCount(1);
    await page.getByRole('option').click();
    await expect(search).toBeVisible();
    await expect(page.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    await settings.getByRole('heading', { name: '连接', exact: true }).click();
    await expect(search).toBeHidden();
    await settings.getByRole('button', { name: '选择要添加的模型', exact: true }).click();
    await expect(page.getByRole('option')).toHaveAttribute('aria-selected', 'true');
    await search.fill('推荐模型001');
    await expect(page.getByRole('option')).toHaveCount(1);
    await search.press('ArrowDown');
    await search.press('Enter');
    await expect(page.getByText('已选 2 个', { exact: true })).toBeVisible();
    expect(await page.evaluate(() => window.chaptaleDesktop.agentHost.request('providers', undefined))).toEqual([]);
    await page.getByRole('button', { name: '添加所选', exact: true }).click();
    await expect(search).toBeHidden();
    await settings.getByRole('button', { name: '选择要添加的模型', exact: true }).click();
    await search.fill('model-449');
    await expect(page.getByRole('option')).toHaveCount(0);
    await expect(page.getByText('没有匹配项', { exact: true })).toBeVisible();
    await search.fill('推荐模型');
    await expect(page.getByRole('option')).toHaveCount(448);
    await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1100, 760));
    const popup = page.locator('.app-combobox-content');
    const bounds = await popup.boundingBox();
    expect(bounds!.width).toBeGreaterThan(250);
    expect(bounds!.height).toBeLessThan(450);
    await search.press('Escape');
    await settings.getByRole('button', { name: '保存', exact: true }).click();
    await expect(settings.getByRole('status')).toContainText('已保存');
    const providers = await page.evaluate(() => window.chaptaleDesktop.agentHost.request('providers', undefined));
    expect(providers[0].config.models).toEqual([
      { id: 'model-001', name: '推荐模型001' },
      { id: 'model-449', name: '推荐模型449' }
    ]);
    await expect(settings.getByRole('button', { name: '选择要添加的模型', exact: true })).toHaveCount(0);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});

test('真实子进程退出会通知界面，重新连接只读快照', async () => {
  await page.evaluate(async () => {
    await window.chaptaleDesktop.agentHost.request('state', undefined);
    window.chaptaleDesktop.agentHost.onDisconnected(message => {
      document.body.dataset.hostExit = message;
    });
  });
  const pid = await application.evaluate(
    ({ app }) => app.getAppMetrics().find(process => process.name === 'Chaptale Application')?.pid
  );
  expect(pid).toBeDefined();
  await application.evaluate((_electron, target) => process.kill(target!), pid);
  await expect.poll(() => page.evaluate(() => document.body.dataset.hostExit)).toContain('应用宿主已退出');
  const state = await page.evaluate(() => window.chaptaleDesktop.agentHost.request('state', undefined));
  expect(state.sessions).toEqual([]);
});
