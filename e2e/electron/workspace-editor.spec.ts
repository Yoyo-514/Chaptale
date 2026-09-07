import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

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

async function launchApp() {
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath: electronExecutable,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  page.on('pageerror', error => pageErrors.push(error.message));
}

async function crashIsolatedApp() {
  const running = app;
  if (!running) return;
  const child = running.process();
  const userDataArgument = `--user-data-dir=${path.join(home, 'user-data')}`;
  expect(
    child.spawnargs.some(argument => argument === userDataArgument || argument.includes(`"${userDataArgument}"`))
  ).toBe(true);
  expect(path.basename(home).startsWith('chaptale-editor-e2e-')).toBe(true);
  expect(child.pid).toBeGreaterThan(0);
  if (child.exitCode !== null || child.signalCode !== null) {
    app = undefined;
    return;
  }
  const exited = once(child, 'close');
  if (process.platform === 'win32') {
    try {
      await promisify(execFile)('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true });
    } catch (error) {
      // 超时收尾可能已经关闭测试进程；只在进程确已退出时忽略 taskkill 的竞态错误。
      if (child.exitCode === null && child.signalCode === null) throw error;
    }
  } else {
    child.kill('SIGKILL');
  }
  await exited;
  app = undefined;
}

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
  pageErrors = [];
  await launchApp();
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
      await page.screenshot({ path: testInfo.outputPath('failure.png'), timeout: 5_000 });
    }
    if (testInfo.status !== testInfo.expectedStatus) await crashIsolatedApp();
    else await app?.close();
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
  await page.locator(`[data-tree-path="${folder}/第一章.md"]`).click();
}

test('候选留档经真实 IPC 恢复、确认接受并独立撤销，正文基线不被 watch 重置', async () => {
  const directory = path.join(workspace, '.chaptale/revisions/candidates');
  await mkdir(directory, { recursive: true });
  const proposed = chapter.replace('林晚收起了信', '林晚将信藏进袖口');
  await writeFile(
    path.join(directory, 'candidate-fixture.json'),
    JSON.stringify({
      id: 'candidate-fixture',
      revision: 1,
      status: 'ready',
      targetPath: '正文/第一章.md',
      baselineHash: createHash('sha256').update(chapter).digest('hex'),
      baselineContent: chapter,
      proposedContent: proposed,
      range: { from: 0, to: chapter.length },
      goal: '合法留档消费测试',
      packId: 'fixture-pack',
      personaId: 'draft',
      model: { provider: 'fixture', modelId: 'saved-output' },
      usedStalePack: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptances: []
    })
  );
  await openChapter();
  await page.getByRole('tab', { name: '候选', exact: true }).click();
  await page.getByRole('button', { name: /正文\/第一章.md.*待处理/ }).click();
  const dialog = page.getByRole('dialog', { name: '候选差异' });
  await expect(dialog.getByRole('textbox', { name: '候选稿' })).toContainText('藏进袖口');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'm5-candidate-diff.png') });
  await dialog.getByRole('button', { name: '全部接受', exact: true }).click();
  await expect(dialog.getByText(/移除.*加入.*字符/)).toContainText('正文/第一章.md');
  await dialog.getByRole('button', { name: '确认全部接受', exact: true }).click();
  await expect.poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(proposed);
  await expect(dialog.getByRole('button', { name: '全部接受', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('藏进袖口');
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('收起了信');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  const stored = JSON.parse(await readFile(path.join(directory, 'candidate-fixture.json'), 'utf8'));
  expect(stored.status).toBe('accepted');
  expect(stored.acceptances).toHaveLength(1);
});

test('正文变化后的候选只读差异，不能绕过 stale 写回', async () => {
  await mkdir(path.join(workspace, '.chaptale/revisions/candidates'), { recursive: true });
  await writeFile(
    path.join(workspace, '.chaptale/revisions/candidates/stale-fixture.json'),
    JSON.stringify({
      id: 'stale-fixture',
      revision: 1,
      status: 'ready',
      targetPath: '正文/第一章.md',
      baselineHash: createHash('sha256').update('旧正文').digest('hex'),
      baselineContent: '旧正文',
      proposedContent: '旧候选',
      range: { from: 0, to: 3 },
      goal: '过期留档',
      packId: 'fixture-pack',
      personaId: 'draft',
      model: { provider: 'fixture', modelId: 'saved-output' },
      usedStalePack: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      acceptances: []
    })
  );
  await page.getByRole('tab', { name: '候选', exact: true }).click();
  await page.getByRole('button', { name: /正文\/第一章.md.*正文已变化/ }).click();
  const dialog = page.getByRole('dialog', { name: '候选差异' });
  await expect(dialog.getByText('正文已变化，此候选不能直接接受。')).toBeVisible();
  await expect(dialog.getByRole('button', { name: '全部接受', exact: true })).toHaveCount(0);
  await dialog.getByRole('button', { name: '放弃候选' }).click();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
});

test('独立审查从落盘结果定位正文，状态分离保存并在重启后恢复', async () => {
  const reviewDir = path.join(workspace, '.chaptale/reviews');
  await mkdir(path.join(reviewDir, 'jobs'), { recursive: true });
  const output = JSON.stringify({
    summary: '一处节奏建议',
    issues: [
      {
        agentType: 'style',
        type: 'flat_rhythm',
        severity: 'medium',
        quote: '林晚收起了信',
        reason: '动作缺少衔接',
        suggestion: '补一个动作细节'
      }
    ]
  });
  await writeFile(path.join(reviewDir, 'review-fixture.json'), output);
  await writeFile(
    path.join(reviewDir, 'jobs/review-job.json'),
    JSON.stringify({
      id: 'review-job',
      personaId: 'style-reviewer',
      targetPath: '正文/第一章.md',
      text: chapter.replace(/\r\n/g, '\n'),
      baselineHash: createHash('sha256').update(chapter).digest('hex'),
      model: { provider: 'fixture', modelId: 'stored-output' },
      memoryRefs: [],
      excludedSources: [],
      status: 'done',
      runId: 'review-fixture',
      outputRef: '.chaptale/reviews/review-fixture.json',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  );
  await page.getByRole('button', { name: '审查', exact: true }).click();
  await page.getByRole('button', { name: /正文\/第一章.md.*文风.*已完成/ }).click();
  const panel = page.getByRole('region', { name: '独立审查' });
  await expect(panel.getByText('一处节奏建议')).toBeVisible();
  await expect(page.locator('.document-codemirror .review-mark')).toContainText('林晚收起了信');
  await page.locator('.document-codemirror .review-mark').click();
  await expect(panel.locator('.review-issue-row')).toHaveClass(/selected/);
  await panel.getByRole('button', { name: '定位', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('林晚收起了信');
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'm5-review-anchor.png') });
  await panel.getByRole('checkbox', { name: '选择问题 1', exact: true }).check();
  await panel.getByRole('button', { name: '修订所选 (1)', exact: true }).click();
  const rewrite = page.getByRole('dialog', { name: '提出候选修订', exact: true });
  await expect(rewrite).toBeVisible();
  await expect(rewrite.getByRole('region', { name: '选中的问题' })).toContainText('林晚收起了信');
  await expect(rewrite.getByRole('region', { name: '允许修改的原文' })).toHaveText(/雪落在窗沿，林晚收起了信/);
  await expect(rewrite.getByRole('button', { name: '创建修订候选', exact: true })).toBeDisabled();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await page.screenshot({ path: path.join(visualDir, 'm5-rewrite-confirm.png') });
  await rewrite.getByRole('button', { name: '取消', exact: true }).click();
  await panel.getByRole('button', { name: '忽略', exact: true }).click();
  await expect(page.locator('.document-codemirror .review-mark')).toHaveCount(0);
  expect(await readFile(path.join(reviewDir, 'review-fixture.json'), 'utf8')).toBe(output);
  expect(JSON.parse(await readFile(path.join(reviewDir, 'review-fixture.state.json'), 'utf8')).issues['0'].status).toBe(
    'ignored'
  );
  await page.reload();
  await page.getByRole('button', { name: '审查', exact: true }).click();
  await page.getByRole('button', { name: /正文\/第一章.md.*文风.*已完成/ }).click();
  await page.getByRole('combobox', { name: '问题处理状态' }).selectOption('ignored');
  await expect(page.getByRole('button', { name: '重新打开', exact: true })).toBeVisible();
});

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

test('单击文件打开或切换标签，双击不重复打开，编辑在保存前不写盘', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  const row = page.getByRole('treeitem', { name: '第一章.md', exact: true });
  await row.click();
  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).click();
  await expect(page.getByRole('tab', { name: '空文件.txt', exact: true })).toHaveAttribute('aria-selected', 'true');
  await row.click();
  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await row.dblclick();
  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveCount(1);

  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  const content = page.getByRole('textbox', { name: '文档正文' });
  await page.getByRole('button', { name: '折叠或展开元数据' }).click();
  await expect(content).toContainText('title: 初雪');
  await expect(content).toContainText('雪落在窗沿');
  await expect(content).toHaveAttribute('aria-readonly', 'false');
  await content.click();
  await page.keyboard.type('should-not-be-written');
  await expect(content).toContainText('should-not-be-written');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await page.keyboard.press('Control+z');
});

test('索引 worker 经真实 preload 返回资产、反链与移动结果，参考快照只增', async () => {
  await mkdir(path.join(workspace, '角色'));
  await writeFile(
    path.join(workspace, '角色/林晚.md'),
    '---\nid: lin-wan\nkind: character\ntitle: 林晚\n---\n修表匠。'
  );
  await writeFile(path.join(workspace, '正文/第一章.md'), `${chapter}\n[[林晚]]`);
  const listed = await page.evaluate(
    async rootPath => (window as DesktopWindow).chaptaleDesktop.library.listAssets({ rootPath }),
    workspace
  );
  expect(listed.assets.find(asset => asset.id === 'lin-wan')?.backlinks).toContain('正文/第一章.md');
  await page.getByRole('tab', { name: '参考', exact: true }).click();
  await page.getByRole('textbox', { name: '写作目标' }).fill('雪夜初见');
  await page.getByRole('button', { name: '加入参考 林晚', exact: true }).click();
  await expect(page.getByRole('button', { name: '取消固定 林晚' })).toBeVisible();
  await page.getByRole('button', { name: '冻结参考', exact: true }).click();
  await expect(page.getByText(/^已冻结 /)).toBeVisible();
  expect(await readdir(path.join(workspace, '.chaptale/packs'))).toHaveLength(1);
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'm4-reference-pack.png') });
  await writeFile(
    path.join(workspace, '角色/林晚.md'),
    '---\nid: lin-wan\nkind: character\ntitle: 林晚\n---\n新的角色状态。'
  );
  await expect(page.getByText('来源已更新', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '冻结参考', exact: true }).click();
  await expect.poll(() => readdir(path.join(workspace, '.chaptale/packs'))).toHaveLength(2);
  await rename(path.join(workspace, '角色/林晚.md'), path.join(workspace, '角色/林晚新.md'));
  const moved = await page.evaluate(
    async rootPath =>
      (window as DesktopWindow).chaptaleDesktop.library.resolveLink({ rootPath, link: '[[角色/林晚]]' }),
    workspace
  );
  expect(moved).toMatchObject({ status: 'moved', targetPath: '角色/林晚新.md' });
});

test('元数据默认折叠，标题导航、双链补全与跳转均操作真实文档', async () => {
  await mkdir(path.join(workspace, '角色'));
  await writeFile(
    path.join(workspace, '角色/林晚.md'),
    '---\nid: lin-wan\nkind: character\ntitle: 林晚\n---\n修表匠。'
  );
  await openChapter();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await expect(content).not.toContainText('title: 初雪');
  await page.getByRole('button', { name: '标题大纲', exact: true }).click();
  await page.getByRole('navigation', { name: '标题大纲' }).getByRole('button', { name: '第一章' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('\n[[');
  await expect(page.getByRole('option').filter({ hasText: '林晚' })).toBeVisible();
  await page.getByRole('option').filter({ hasText: '林晚' }).click();
  await expect(content).toContainText('[[角色/林晚]]');
  await page.keyboard.press('Control+s');
  await page
    .locator('.cm-wiki-link')
    .filter({ hasText: '角色/林晚' })
    .click({ modifiers: ['Control'] });
  await expect(page.getByRole('tab', { name: '角色/林晚.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(content).toContainText('修表匠');
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'm4-library-navigation.png') });
});

test('外部新增前置目录后，虚拟树仍保持文件焦点和打开目标', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.locator('[data-tree-path="正文/第一章.md"]').focus();
  await mkdir(path.join(workspace, '000-新目录'));
  await expect(page.getByRole('treeitem', { name: '000-新目录', exact: true })).toBeVisible();
  await expect(page.locator('[data-tree-path="正文/第一章.md"]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('tab', { name: '正文/第一章.md', exact: true })).toHaveAttribute('aria-selected', 'true');
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('雪落在窗沿');
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
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).click();
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

test('磁盘更新自动刷新干净标签和文件树，不需要手动刷新', async () => {
  await openChapter();
  const updated = '# 新的磁盘正文\n外部编辑器写入。';
  await writeFile(path.join(workspace, '正文/第一章.md'), updated);
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('外部编辑器写入');
  await expect(page.getByText('已载入磁盘更新', { exact: true })).toBeVisible();
  await writeFile(path.join(workspace, '自动出现.md'), '新文件');
  await expect(page.getByRole('treeitem', { name: '自动出现.md', exact: true })).toBeVisible();
  await rm(path.join(workspace, '自动出现.md'));
  await expect(page.getByRole('treeitem', { name: '自动出现.md', exact: true })).toHaveCount(0);
});

test('脏文档的外部变化进入只读 diff，保留本地前留存外部版本', async () => {
  await openChapter();
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('作者本地修改');
  await writeFile(path.join(workspace, '正文/第一章.md'), '另一台设备的新版本');
  await page.getByRole('button', { name: '对比版本', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '磁盘版本冲突' });
  await expect(dialog).toContainText('另一台设备的新版本');
  await expect(dialog).toContainText('作者本地修改');
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'external-conflict.png') });
  await dialog.getByRole('button', { name: '保留我的', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter + '作者本地修改');
  const cache = path.join(home, '.chaptale/cache/editor-recovery');
  const preserved = (await readdir(cache, { recursive: true })).filter(
    file => file.includes('conflicts') && file.endsWith('.json')
  );
  expect(preserved).toHaveLength(1);
  expect(JSON.parse(await readFile(path.join(cache, preserved[0]!), 'utf8')).content).toBe('另一台设备的新版本');
});

test('脏文档可明确采用外部版本，删除原文件仍能另存恢复副本', async () => {
  await openChapter();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('放弃的修改');
  await writeFile(path.join(workspace, '正文/第一章.md'), '采用外部内容');
  await page.getByRole('button', { name: '对比版本', exact: true }).click();
  await page.getByRole('button', { name: '接受外部', exact: true }).click();
  await expect(content).toContainText('采用外部内容');
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('留下的本地内容');
  await rm(path.join(workspace, '正文/第一章.md'));
  await page.getByRole('button', { name: '对比版本', exact: true }).click();
  await page.getByRole('button', { name: '另存副本', exact: true }).click();
  await expect(page.getByRole('tab', { name: '正文/第一章-恢复副本.md', exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace, '正文/第一章-恢复副本.md'), 'utf8')).toBe('采用外部内容留下的本地内容');
  await page.getByRole('button', { name: '关闭 正文/第一章.md', exact: true }).click();
  await page.getByRole('dialog').getByRole('button', { name: '不保存', exact: true }).click();
});

test('意外退出后恢复未保存草稿，磁盘基线改变时禁止直接覆盖', async () => {
  test.setTimeout(60_000);
  await openChapter();
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('意外退出前的文字');
  await expect
    .poll(async () =>
      page.evaluate(
        async rootPath =>
          (await (window as DesktopWindow).chaptaleDesktop.workspace.listRecoveries({ rootPath })).length,
        workspace
      )
    )
    .toBe(1);
  await crashIsolatedApp();
  await writeFile(path.join(workspace, '正文/第一章.md'), '重启前的外部版本');
  await launchApp();
  await expect(page.getByText('上次未保存的草稿（1）', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('意外退出前的文字');
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('恢复后继续写作');
  await expect
    .poll(() =>
      page.evaluate(
        async rootPath =>
          await (window as DesktopWindow).chaptaleDesktop.workspace.readRecovery({
            rootPath,
            relativePath: '正文/第一章.md'
          }),
        workspace
      )
    )
    .toMatchObject({
      expectedHash: createHash('sha256').update(chapter).digest('hex'),
      content: chapter + '意外退出前的文字恢复后继续写作'
    });
  await crashIsolatedApp();
  await launchApp();
  await page.getByRole('button', { name: '恢复', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('恢复后继续写作');
  await page.keyboard.press('Control+s');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe('重启前的外部版本');
  await page.getByRole('button', { name: '对比版本', exact: true }).click();
  await page.getByRole('button', { name: '保留我的', exact: true }).click();
  await expect
    .poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8'))
    .toBe(chapter + '意外退出前的文字恢复后继续写作');
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
  await page.getByRole('treeitem', { name: '损坏.md', exact: true }).click();
  await expect(page.getByText('frontmatter 无法解析', { exact: true })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('title: [坏的元数据');
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).click();
  await expect(page.getByText('空文件', { exact: true })).toBeVisible();
  await page.getByRole('treeitem', { name: '二进制.bin', exact: true }).click();
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
  await page.getByRole('treeitem', { name: '原文.html', exact: true }).click();
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
    document.querySelector('[data-tree-path="在途.md"]')!.dispatchEvent(new MouseEvent('click', { bubbles: true }));
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
  await page.getByRole('treeitem', { name: '阅读.md', exact: true }).click();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await content.click();
  await page.keyboard.press('Control+End');
  await expect(content).toContainText('阅读位置标记');
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).click();
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

test('多标签使用覆盖式横向滚动，活动标签自动可见且高度不变', async () => {
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1024, 720));
  const files = Array.from(
    { length: 12 },
    (_, index) => `标签-${String(index).padStart(2, '0')}-车间夜谈与旧日来信.md`
  );
  for (const file of files) await writeFile(path.join(workspace, file), `# ${file}\n正文`);
  await page.getByRole('button', { name: '刷新文件树' }).click();
  for (const file of files) {
    await page.getByRole('treeitem', { name: file, exact: true }).click();
    await expect(page.getByRole('tab', { name: file, exact: true })).toHaveAttribute('aria-selected', 'true');
  }
  const viewport = page.locator('.editor-tabs-scroll [data-slot="app-scroll-area-viewport"]');
  const bounds = await viewport.evaluate(element => {
    const tab = element.querySelector('[role="tab"][aria-selected="true"]')!.getBoundingClientRect();
    const frame = element.getBoundingClientRect();
    return {
      overflow: element.scrollWidth > element.clientWidth,
      offset: element.scrollLeft,
      nativeScrollbar: element.getBoundingClientRect().height - element.clientHeight,
      inside: tab.left >= frame.left - 1 && tab.right <= frame.right + 1
    };
  });
  expect(bounds).toMatchObject({ overflow: true, inside: true, nativeScrollbar: 0 });
  expect(bounds.offset).toBeGreaterThan(0);
  await expect(page.locator('.editor-tabs-scroll')).toHaveCSS('height', '36px');
  await viewport.hover();
  await expect(
    page.locator('.editor-tabs-scroll [data-orientation="horizontal"][data-slot="app-scroll-area-scrollbar"]')
  ).toBeVisible();
  await page.mouse.wheel(0, -600);
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBeLessThan(bounds.offset);
  await page.getByRole('treeitem', { name: files[0]!, exact: true }).click();
  await expect.poll(() => viewport.evaluate(element => element.scrollLeft)).toBe(0);
  await page.getByRole('tab', { name: files[0]!, exact: true }).focus();
  await page.keyboard.press('End');
  await expect(page.getByRole('tab', { name: files.at(-1)!, exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('Delete');
  await expect(page.getByRole('tab', { name: files.at(-2)!, exact: true })).toBeFocused();
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'editor-overflow-tabs.png') });
});

test('行号与正文垂直对齐，当前行和选区在三种主题中清晰区分', async () => {
  await writeFile(path.join(workspace, '空文件.txt'), '第一行\n第二行\n第三行\n' + '下一行\n'.repeat(20));
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).click();
  const content = page.getByRole('textbox', { name: '文档正文' });
  await mkdir(visualDir, { recursive: true });
  for (const [label, theme] of [
    ['浅色', 'theme-light'],
    ['深色', 'dark'],
    ['暖色', 'theme-warm']
  ] as const) {
    await page.getByRole('menuitem', { name: '视图', exact: true }).click();
    await page.getByRole('menuitem', { name: '外观', exact: true }).focus();
    await page.getByRole('menuitem', { name: '外观', exact: true }).press('ArrowRight');
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await content.click();
    await page.keyboard.press('Control+Home');
    await page.keyboard.press('ArrowDown');
    const active = page.locator('.document-codemirror .cm-activeLine');
    const gutter = page.locator('.document-codemirror .cm-activeLineGutter');
    await expect(active).toHaveText('第二行');
    await expect(gutter).toHaveText('2');
    const geometry = await page.evaluate(() => {
      const line = document.querySelector('.document-codemirror .cm-activeLine')!;
      const number = document.querySelector('.document-codemirror .cm-activeLineGutter')!;
      const a = line.getBoundingClientRect();
      const b = number.getBoundingClientRect();
      return {
        offset: Math.abs(a.top - b.top),
        lineHeight: getComputedStyle(line).lineHeight,
        gutterLineHeight: getComputedStyle(number).lineHeight,
        background: getComputedStyle(line).backgroundColor
      };
    });
    expect(geometry.offset).toBeLessThanOrEqual(1);
    expect(geometry.lineHeight).toBe(geometry.gutterLineHeight);
    expect(geometry.background).not.toBe('rgba(0, 0, 0, 0)');
    await page.screenshot({ path: path.join(visualDir, `editor-active-line-${theme}.png`) });
    await page.keyboard.press('Shift+End');
    await expect(page.locator('.document-codemirror .cm-selectionBackground')).toBeVisible();
    expect(
      await page
        .locator('.document-codemirror .cm-selectionBackground')
        .first()
        .evaluate(element => getComputedStyle(element).backgroundColor)
    ).not.toBe(geometry.background);
  }
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
  await page.getByRole('treeitem', { name: '大文件.txt', exact: true }).click();
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

test('空目录有标记，外部移动目录后树移除并在移回时重现', async () => {
  await mkdir(path.join(workspace, '空目录'));
  await page.getByRole('button', { name: '刷新文件树' }).click();
  const empty = page.locator('[data-tree-path="空目录"]');
  await empty.click();
  await expect(empty.getByText('空', { exact: true })).toBeVisible();
  await rename(path.join(workspace, '设定'), path.join(home, 'moved'));
  await expect(page.getByRole('treeitem', { name: '设定', exact: true })).toHaveCount(0);
  await rename(path.join(home, 'moved'), path.join(workspace, '设定'));
  await page.getByRole('treeitem', { name: '设定', exact: true }).click();
  await expect(page.locator('[data-tree-path="设定/第一章.md"]')).toBeVisible();
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
    await page.getByRole('menuitem', { name: '外观', exact: true }).focus();
    await page.getByRole('menuitem', { name: '外观', exact: true }).press('ArrowRight');
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
    await page.getByRole('treeitem', { name: '长文.md', exact: true }).click();
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
