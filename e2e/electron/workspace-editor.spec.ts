import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import type { SettlementBatch } from '@chaptale/shared';

const desktopDir = path.resolve('apps/desktop');
const desktopRequire = createRequire(path.join(desktopDir, 'package.json'));
const electronExecutable = desktopRequire('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `t5-editor-${Date.now()}`);
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };
const hash = (content: string) => createHash('sha256').update(content).digest('hex');

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
      onboarding: { completedVersion: 1 },
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
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(pageErrors).toEqual([]);
});

async function openChapter(folder = '正文') {
  await page.getByRole('treeitem', { name: folder, exact: true }).click();
  await page.locator(`[data-tree-path="${folder}/第一章.md"]`).click();
}

async function createStoryAssets() {
  await mkdir(path.join(workspace, '角色'), { recursive: true });
  await mkdir(path.join(workspace, '设定/时间线'), { recursive: true });
  await writeFile(
    path.join(workspace, '角色/林晚.md'),
    '---\nid: linwan\nkind: character\ntitle: 林晚\ncustom: retained # 作者字段\nrelations:\n  - null\n  - { to: "[[顾沉]]", type: 师父, private: 暂不公开 }\n---\n林晚的原文。\n'
  );
  await writeFile(
    path.join(workspace, '角色/顾沉.md'),
    '---\nid: guchen\nkind: character\ntitle: 顾沉\n---\n远行归来。\n'
  );
  await writeFile(
    path.join(workspace, '设定/时间线/夜航.md'),
    '---\nkind: timeline-event\ntitle: 夜航\norder: 2\nwhen: 清河历八年冬\nstrand: 归途\nsummary: 二人乘舟过江。\ncast: ["[[林晚]]", "[[顾沉]]"]\nchapter: "[[正文/第一章.md]]"\ncustom: retained # 作者字段\n---\n事件原文。\n'
  );
  await writeFile(
    path.join(workspace, '设定/时间线/相逢.md'),
    '---\nkind: timeline-event\ntitle: 相逢\norder: 1\nwhen: 重逢前三日\nstrand: 归途\nsummary: 林晚收到来信。\n---\n'
  );
  await writeFile(path.join(workspace, '设定/时间线/待定.md'), '---\nkind: timeline-event\ntitle: 待定事件\n---\n');
}

async function openContentSettings() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '专员与内容 专员、技能、模板', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专员与创作内容' })).toBeVisible();
}

async function openWorkspaceView(label: '资料库' | '故事时间线' | '角色关系') {
  const tab = page.getByRole('tab', { name: label, exact: true });
  if (await tab.count()) await tab.click();
  else {
    if (!(await page.getByRole('region', { name: '资料库导航', exact: true }).isVisible()))
      await page.getByRole('button', { name: '资料库', exact: true }).click();
    await page.getByRole('button', { name: `打开${label}`, exact: true }).click();
  }
  await expect(tab).toHaveAttribute('aria-selected', 'true');
}

test('M6 专员表单落盘、切换创建新会话，停用后不回退身份', async () => {
  await openContentSettings();
  await page.getByRole('button', { name: '新建专员', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建专员', exact: true });
  await dialog.getByRole('textbox', { name: '专员标识', exact: true }).fill('scene-helper');
  await dialog.getByLabel('名称', { exact: true }).fill('场景助手');
  await dialog.getByRole('checkbox', { name: '情节摘要', exact: true }).check();
  await dialog.getByRole('tab', { name: '职责正文', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: '职责正文', exact: true })
    .fill('围绕角色选择讨论场景，保留作者明确的约束。');
  await dialog.getByRole('button', { name: '保存专员', exact: true }).click();
  await expect(dialog).toBeHidden();
  const filename = path.join(home, '.chaptale/personas/scene-helper.md');
  expect(await readFile(filename, 'utf8')).toContain('场景助手');
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await page.getByRole('combobox', { name: '对话专员', exact: true }).click();
  await page.getByRole('option', { name: '场景助手', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '对话专员', exact: true })).toContainText('场景助手');
  const sessions = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.session.list());
  const selected = sessions.find(session => session.personaId === 'scene-helper');
  expect(selected).toBeDefined();
  await page.reload();
  await expect(page.getByRole('combobox', { name: '对话专员', exact: true })).toContainText('场景助手');
  await openContentSettings();
  await page.getByRole('button', { name: '场景助手 scene-helper', exact: true }).click();
  const editing = page.getByRole('dialog', { name: '编辑专员', exact: true });
  await editing.getByRole('tab', { name: '专员与权限', exact: true }).click();
  await editing.getByRole('checkbox', { name: '启用', exact: true }).uncheck();
  await editing.getByRole('button', { name: '保存专员', exact: true }).click();
  await expect(editing).toBeHidden();
  await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  await expect(page.getByRole('combobox', { name: '对话专员', exact: true })).toContainText('scene-helper · 不可用');
  const failure = await page.evaluate(async id => {
    try {
      await (window as DesktopWindow).chaptaleDesktop.agent.getContextPressure(id);
      return '';
    } catch (error) {
      return String(error);
    }
  }, selected!.id);
  expect(failure).toContain('对话专员不可用');
});

test('M6 内容包预览降权，逐项导入后停用专员，真实文件冲突保留', async () => {
  const rootPath = workspace;
  const exported = await page.evaluate(async root => {
    const api = (window as DesktopWindow).chaptaleDesktop;
    const markdown =
      '---\nid: shared-reviewer\nname: 分享审查\ntype: review\nexecution: task\noutput: custom-issues\ntools: [memory_search]\nmemory:\n  read: [canon, summaries]\nmodel:\n  preference: private/model\ndelegatable: true\nenabled: true\n---\n仅检查叙事视角。\n';
    const document = await api.content.save({
      rootPath: root,
      scope: 'user',
      kind: 'persona',
      id: 'shared-reviewer',
      markdown
    });
    const { kind, id, source, sourcePath, hash: contentHash } = document;
    return api.content.previewExport({ rootPath: root, refs: [{ kind, id, source, sourcePath, hash: contentHash }] });
  }, rootPath);
  expect(exported).not.toContain('private/model');
  expect(exported).toContain('enabled: false');
  const bundle = path.join(home, 'shared-content.json');
  await writeFile(bundle, exported);
  await openContentSettings();
  await page.getByRole('checkbox', { name: '选择 shared-reviewer 所有作品', exact: true }).check();
  await page.getByRole('button', { name: '导出所选 (1)', exact: true }).click();
  const exportDialog = page.getByRole('dialog', { name: '导出内容包', exact: true });
  await expect(exportDialog.getByRole('textbox', { name: '实际导出内容', exact: true })).toHaveValue(exported);
  await expect(exportDialog.getByRole('button', { name: '导出文件', exact: true })).toBeDisabled();
  await exportDialog.getByRole('button', { name: '取消', exact: true }).click();
  await page.getByRole('button', { name: '导入', exact: true }).click();
  const importDialog = page.getByRole('dialog', { name: '导入内容包', exact: true });
  await importDialog.getByRole('combobox', { name: '导入范围' }).click();
  await page.getByRole('option', { name: '当前作品', exact: true }).click();
  await importDialog.locator('input[type="file"]').setInputFiles(bundle);
  await expect(importDialog.getByRole('textbox', { name: '将导入的完整内容' })).toHaveValue(/enabled: false/);
  await importDialog.getByRole('button', { name: '导入所选 (1)', exact: true }).click();
  await expect(importDialog).toBeHidden();
  const importedPath = path.join(workspace, '.chaptale/personas/shared-reviewer.md');
  expect(await readFile(importedPath, 'utf8')).toContain('enabled: false');
  const workspaceRow = page.locator('.content-row').filter({ hasText: '当前作品 · 停用' });
  await workspaceRow.getByRole('button', { name: '分享审查 shared-reviewer', exact: true }).click();
  const editing = page.getByRole('dialog', { name: '编辑专员', exact: true });
  await editing.getByRole('textbox', { name: '职责正文', exact: true }).fill('尚未保存的本机修改。');
  const external = (await readFile(importedPath, 'utf8')).replace('仅检查叙事视角。', '外部更新。');
  await writeFile(importedPath, external);
  await editing.getByRole('button', { name: '保存专员', exact: true }).click();
  await expect(editing.getByRole('alert')).toContainText('内容已变化');
  await expect(editing.getByRole('textbox', { name: '职责正文', exact: true })).toHaveValue('尚未保存的本机修改。');
  expect(await readFile(importedPath, 'utf8')).toBe(external);
  await editing.getByRole('button', { name: '取消', exact: true }).click();
  await page
    .getByRole('dialog', { name: '放弃未保存的内容？', exact: true })
    .getByRole('button', { name: '放弃修改', exact: true })
    .click();
});

test('M6 自定义审查留档可定位、处理，并在三主题内容管理中可读', async () => {
  const result = {
    summary: '一处视角问题',
    issues: [
      {
        agentType: 'custom',
        type: '视角跳转',
        severity: 'medium',
        quote: '林晚收起了信。',
        reason: '观察者未明确。',
        suggestion: '明确此处观察者。'
      }
    ]
  };
  await mkdir(path.join(workspace, '.chaptale/reviews/jobs'), { recursive: true });
  const normalized = chapter.replace(/\r\n/g, '\n');
  await writeFile(path.join(workspace, '.chaptale/reviews/custom-run.json'), JSON.stringify(result));
  await writeFile(
    path.join(workspace, '.chaptale/reviews/jobs/custom-job.json'),
    JSON.stringify({
      id: 'custom-job',
      personaId: 'viewpoint-reviewer',
      personaName: '叙事视角审查',
      outputSchema: 'custom-issues',
      targetPath: '正文/第一章.md',
      baselineHash: hash(chapter),
      text: normalized,
      model: { provider: 'fixture', modelId: 'stored-output' },
      memoryRefs: [],
      excludedSources: [],
      status: 'done',
      runId: 'custom-run',
      outputRef: '.chaptale/reviews/custom-run.json',
      outputHash: hash(JSON.stringify(result)),
      createdAt: '2026-09-09T01:00:00.000Z',
      updatedAt: '2026-09-09T01:00:00.000Z'
    })
  );
  await page.getByRole('button', { name: '审查', exact: true }).click();
  await page.getByRole('region', { name: '审查中心' }).getByRole('button').filter({ hasText: '叙事视角审查' }).click();
  const review = page.getByRole('region', { name: '独立审查', exact: true });
  await expect(review).toContainText('视角跳转');
  await review.getByRole('button', { name: '定位', exact: true }).click();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('林晚收起了信。');
  await review.getByRole('button', { name: '已处理', exact: true }).click();
  await expect(review).toContainText('没有符合筛选条件的问题');
  expect(
    JSON.parse(await readFile(path.join(workspace, '.chaptale/reviews/custom-run.state.json'), 'utf8')).issues['0']
      .status
  ).toBe('resolved');
  await mkdir(visualDir, { recursive: true });
  for (const theme of ['light', 'warm', 'dark'] as const) {
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    await page.reload();
    await openContentSettings();
    await page.getByRole('button', { name: '故事策划 blueprint', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '编辑专员', exact: true });
    await expect(dialog.getByRole('textbox', { name: '职责正文', exact: true })).toHaveValue(/你与作者/);
    await page.screenshot({ path: path.join(visualDir, `m6-content-${theme}.png`) });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();
  }
});

test('M6 全文搜索区分范围并定位正文，记忆原文可独立浏览', async () => {
  await mkdir(path.join(workspace, '.chaptale/memory/notes'), { recursive: true });
  await writeFile(
    path.join(workspace, '.chaptale/memory/notes/观察.md'),
    '---\nkind: note\ntitle: 作者观察\n---\n林晚仍未拆信。\n'
  );
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索作品文本', exact: true }).fill('林晚');
  const search = page.getByRole('region', { name: '作品全文搜索' });
  await expect(search.getByRole('status')).toHaveText('1 处匹配 · 3 个文件');
  await search.getByRole('button').filter({ hasText: '雪落在窗沿' }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toBeVisible();
  await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('林晚');
  await search.getByRole('combobox', { name: '搜索范围' }).click();
  await page.getByRole('option', { name: '观察与摘要', exact: true }).click();
  await expect(search.getByRole('button').filter({ hasText: '作者观察' })).toBeVisible();
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  const memory = page.getByRole('region', { name: '作品记忆' });
  await memory.getByRole('button').filter({ hasText: '作者观察' }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toContainText('林晚仍未拆信');
  await page.getByRole('button', { name: '记忆', exact: true }).click();
  await expect(memory).toBeHidden();
});

test('M6 菜单作用于当前输入焦点，新会话和运行入口可用', async () => {
  await openChapter();
  const prompt = page.locator('.chat-main textarea').first();
  await prompt.click();
  await prompt.pressSequentially('draft text');
  await page.getByRole('menuitem', { name: '编辑', exact: true }).click();
  await page.getByRole('menuitem', { name: '撤销', exact: true }).click();
  await expect(prompt).toHaveValue('');
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toContainText('雪落在窗沿');
  const count = await page.evaluate(
    async () => (await (window as DesktopWindow).chaptaleDesktop.session.list()).length
  );
  await page.getByRole('menuitem', { name: 'Agent', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建会话', exact: true }).click();
  await expect
    .poll(() => page.evaluate(async () => (await (window as DesktopWindow).chaptaleDesktop.session.list()).length))
    .toBe(count + 1);
  await page.getByRole('menuitem', { name: 'Agent', exact: true }).click();
  await page.getByRole('menuitem', { name: '查看运行记录', exact: true }).click();
  await expect(page.getByRole('region', { name: '运行记录' })).toBeVisible();
  await page.getByRole('menuitem', { name: '帮助', exact: true }).click();
  await page.getByRole('menuitem', { name: '配置与诊断', exact: true }).click();
  await expect(page.getByRole('heading', { name: '配置文件', exact: true })).toBeVisible();
});

test('M6 故事时间线按情节排序，编辑事件与新建资产保留文件事实', async () => {
  await createStoryAssets();
  await openChapter();
  await page.getByRole('textbox', { name: '文档正文', exact: true }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('切换资产视图仍保留的草稿。');
  await openWorkspaceView('资料库');
  const library = page.getByRole('region', { name: '作品资料库', exact: true });
  await library.getByRole('textbox', { name: '搜索资料库', exact: true }).fill('林晚');
  await expect(library.locator('[data-asset-path]')).toHaveCount(2);
  await library.getByRole('combobox', { name: '资料类型', exact: true }).click();
  await page.getByRole('option', { name: '角色', exact: true }).click();
  await expect(library.locator('[data-asset-path]')).toHaveCount(1);
  await library.getByRole('button', { name: '资料列表视图', exact: true }).click();
  await expect(library.locator('.asset-library-results')).toHaveClass(/list/);
  await openWorkspaceView('故事时间线');
  const timeline = page.getByRole('region', { name: '作品故事时间线', exact: true });
  await expect(timeline.locator('[data-event-path]')).toHaveCount(3);
  expect(
    await timeline
      .locator('[data-event-path]')
      .evaluateAll(elements => elements.map(element => element.getAttribute('data-event-path')))
  ).toEqual(['设定/时间线/相逢.md', '设定/时间线/夜航.md', '设定/时间线/待定.md']);
  await expect(timeline).toContainText('清河历八年冬');
  await expect(timeline).toContainText('未排序事件');
  await timeline
    .locator('[data-event-path="设定/时间线/夜航.md"]')
    .getByRole('button', { name: '编辑事件', exact: true })
    .click();
  const edit = page.getByRole('dialog', { name: '编辑故事事件', exact: true });
  await edit.getByRole('spinbutton', { name: '故事顺序', exact: true }).fill('0.5');
  await edit.getByRole('textbox', { name: '故事时间', exact: true }).fill('清河历八年冬，子夜之后');
  await edit.getByRole('button', { name: '保存事件', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const saved = await readFile(path.join(workspace, '设定/时间线/夜航.md'), 'utf8');
  expect(saved).toContain('order: 0.5');
  expect(saved).toContain('custom: retained # 作者字段');
  expect(saved).toContain('事件原文。');
  await expect(timeline.locator('[data-event-path]').first()).toHaveAttribute('data-event-path', '设定/时间线/夜航.md');
  await timeline.getByRole('button', { name: '新建事件', exact: true }).click();
  const create = page.getByRole('dialog', { name: '从模板新建', exact: true });
  await create.getByRole('textbox', { name: '事件名称', exact: true }).fill('天亮');
  await create.getByRole('textbox', { name: '故事时间', exact: true }).fill('翌日清晨');
  await create.getByRole('button', { name: '创建文件', exact: true }).click();
  await expect(page.getByRole('tab', { name: '设定/时间线/天亮.md', exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace, '设定/时间线/天亮.md'), 'utf8')).toContain('kind: timeline-event');
  await page.getByRole('tab', { name: '正文/第一章.md', exact: true }).click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toContainText(
    '切换资产视图仍保留的草稿。'
  );
  await page.keyboard.press('Control+s');
  await expect
    .poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8'))
    .toContain('切换资产视图仍保留的草稿。');
});

test('M6 角色关系可编辑新增移除，拖动布局重开恢复', async () => {
  await createStoryAssets();
  await openWorkspaceView('角色关系');
  const graph = page.getByRole('region', { name: '作品角色关系', exact: true });
  await expect(graph.locator('.character-node')).toHaveCount(2);
  await expect(graph.locator('.vue-flow__edge')).toHaveCount(1);
  await graph.locator('.vue-flow__edge-text').filter({ hasText: '师父' }).click();
  const edit = page.getByRole('dialog', { name: '编辑角色关系', exact: true });
  await edit.getByRole('textbox', { name: '关系称谓', exact: true }).fill('旧友');
  await edit.getByRole('textbox', { name: '关系备注', exact: true }).fill('事后反目');
  await edit.getByRole('button', { name: '保存关系', exact: true }).click();
  await expect(edit).not.toBeVisible();
  const original = await readFile(path.join(workspace, '角色/林晚.md'), 'utf8');
  expect(original).toContain('private: 暂不公开');
  expect(original).toContain('custom: retained # 作者字段');
  expect(original).toContain('旧友');
  expect(original).toContain('林晚的原文。');
  await expect(graph.locator('.vue-flow__edge-text')).toHaveText('旧友');
  const node = graph.locator('[data-character-path="角色/林晚.md"]');
  const before = (await node.boundingBox())!;
  await page.mouse.move(before.x + before.width / 2, before.y + 20);
  await page.mouse.down();
  await page.mouse.move(before.x + before.width / 2 + 60, before.y + 65, { steps: 10 });
  await page.mouse.up();
  await expect.poll(async () => (await node.boundingBox())!.x).toBeGreaterThan(before.x + 35);
  const moved = (await node.boundingBox())!;
  await page.reload();
  await openWorkspaceView('角色关系');
  await expect(node).toBeVisible();
  await expect.poll(async () => Math.abs((await node.boundingBox())!.x - moved.x)).toBeLessThan(3);
  await graph.getByRole('button', { name: '新建关系', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建角色关系', exact: true });
  await create.getByRole('combobox', { name: '源角色', exact: true }).fill('角色/顾沉.md');
  await create.getByRole('combobox', { name: '目标角色', exact: true }).fill('角色/林晚.md');
  await create.getByRole('textbox', { name: '关系称谓', exact: true }).fill('学生');
  await create.getByRole('button', { name: '保存关系', exact: true }).click();
  await expect(create).not.toBeVisible();
  await expect(graph.locator('.vue-flow__edge')).toHaveCount(2);
  await graph.locator('.vue-flow__edge-text').filter({ hasText: '学生' }).click();
  await edit.getByRole('button', { name: '移除关系…', exact: true }).click();
  await page
    .getByRole('dialog', { name: '移除角色关系', exact: true })
    .getByRole('button', { name: '确认移除关系', exact: true })
    .click();
  await expect(graph.locator('.vue-flow__edge')).toHaveCount(1);
  expect(await readFile(path.join(workspace, '角色/顾沉.md'), 'utf8')).not.toContain('学生');
  expect(await readFile(path.join(workspace, '角色/林晚.md'), 'utf8')).toBe(original);
});

test('M6 故事资产外部修改保护和三主题画布可读', async () => {
  await createStoryAssets();
  await mkdir(visualDir, { recursive: true });
  for (const theme of ['light', 'warm', 'dark'] as const) {
    await page.evaluate(
      async value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }),
      theme
    );
    await page.reload();
    await openWorkspaceView('角色关系');
    await expect(page.locator('.character-node')).toHaveCount(2);
    await expect(page.locator('.vue-flow__edge-path')).toHaveCount(1);
    const pathData = await page.locator('.vue-flow__edge-path').getAttribute('d');
    expect(pathData?.length).toBeGreaterThan(20);
    const graphIcon = page.getByRole('tab', { name: '角色关系', exact: true }).locator('[aria-hidden="true"]');
    await expect.poll(() => graphIcon.evaluate(element => getComputedStyle(element).maskImage)).not.toBe('none');
    await page.screenshot({ path: path.join(visualDir, `m6-relationships-${theme}.png`) });
    await openWorkspaceView('资料库');
    await expect(page.locator('.asset-card').first()).toBeVisible();
    await expect(page.locator('.asset-card').first()).toHaveCSS('text-align', 'left');
    await page.screenshot({ path: path.join(visualDir, `workbench-library-${theme}.png`) });
  }
  await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setContentSize(1024, 720));
  await page.screenshot({ path: path.join(visualDir, 'workbench-library-dark-1024.png') });
  await openWorkspaceView('故事时间线');
  const timeline = page.getByRole('region', { name: '作品故事时间线', exact: true });
  await expect(timeline.locator('[data-event-path]')).toHaveCount(3);
  await page.screenshot({ path: path.join(visualDir, 'm6-timeline-dark-1024.png') });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await timeline
    .locator('[data-event-path="设定/时间线/夜航.md"]')
    .getByRole('button', { name: '编辑事件', exact: true })
    .click();
  const dialog = page.getByRole('dialog', { name: '编辑故事事件', exact: true });
  await dialog.getByRole('textbox', { name: '事件名称', exact: true }).fill('不应覆盖');
  const target = path.join(workspace, '设定/时间线/夜航.md');
  const external = `${await readFile(target, 'utf8')}\n来自外部编辑器的新段落。\n`;
  await writeFile(target, external);
  await dialog.getByRole('button', { name: '保存事件', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText(/变化|冲突|保存/);
  expect(await readFile(target, 'utf8')).toBe(external);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
});

test('M6 新建作品可直接编辑，同名目录不覆盖', async () => {
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建作品…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建作品', exact: true });
  await dialog.getByRole('textbox', { name: '作品名称', exact: true }).fill('新作品');
  await dialog.getByRole('textbox', { name: '作品存放位置', exact: true }).fill(home);
  await dialog.getByRole('textbox', { name: '创作守则', exact: true }).fill('第三人称有限视角。');
  await dialog.getByRole('button', { name: '创建并打开', exact: true }).click();
  await expect(page.getByRole('tab', { name: '正文/0001-第一章.md', exact: true })).toBeVisible();
  const root = path.join(home, '新作品');
  const manifest = JSON.parse(await readFile(path.join(root, 'chaptale.json'), 'utf8'));
  expect(manifest).toMatchObject({ title: '新作品', kind: 'novel', version: 1 });
  expect(await readFile(path.join(root, '设定/创作守则.md'), 'utf8')).toContain('第三人称有限视角。');
  await page.getByRole('textbox', { name: '文档正文', exact: true }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('新作品的第一句。');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(path.join(root, '正文/0001-第一章.md'), 'utf8')).toContain('新作品的第一句。');
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建作品…', exact: true }).click();
  await dialog.getByRole('button', { name: '创建并打开', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('同名目录');
  expect(JSON.parse(await readFile(path.join(root, 'chaptale.json'), 'utf8')).id).toBe(manifest.id);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
});

test('M6 面板隐藏保留 Agent 草稿，重开后拖动方向一致', async () => {
  const input = page.getByPlaceholder('描述你的创作需求...');
  await input.fill('尚未发送的创作草稿');
  await page.getByRole('button', { name: '切换 Agent 面板', exact: true }).click();
  await expect(input).not.toBeVisible();
  await page.getByRole('button', { name: '切换 Agent 面板', exact: true }).click();
  await expect(input).toHaveValue('尚未发送的创作草稿');
  const sidebar = page.locator('#workbench-primary-sidebar');
  for (let attempt = 0; attempt < 2; attempt++) {
    await page.getByRole('button', { name: '工作区', exact: true }).click();
    await expect.poll(async () => (await sidebar.boundingBox())?.width ?? 0).toBeLessThan(1);
    await page.getByRole('button', { name: '工作区', exact: true }).click();
    const before = (await sidebar.boundingBox())!.width;
    const handle = (await page.getByRole('separator', { name: '调整工作区侧栏宽度', exact: true }).boundingBox())!;
    await page.mouse.move(handle.x + handle.width / 2, handle.y + 150);
    await page.mouse.down();
    await page.mouse.move(handle.x + 40, handle.y + 150, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => (await sidebar.boundingBox())!.width).toBeGreaterThan(before + 15);
  }
  const auxiliary = page.locator('#workbench-auxiliary-bar');
  const before = (await auxiliary.boundingBox())!.width;
  const handle = (await page.getByRole('separator', { name: '调整辅助栏宽度', exact: true }).boundingBox())!;
  await page.mouse.move(handle.x + handle.width / 2, handle.y + 180);
  await page.mouse.down();
  await page.mouse.move(handle.x - 35, handle.y + 180, { steps: 8 });
  await page.mouse.up();
  await expect.poll(async () => (await auxiliary.boundingBox())!.width).toBeGreaterThan(before + 15);
  await expect(input).toHaveValue('尚未发送的创作草稿');
});

test('M6 新作品创建后取消切换保留原稿，再次打开仅确认一次', async () => {
  await openChapter();
  await page.getByRole('textbox', { name: '文档正文', exact: true }).click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('保留在旧作品的草稿。');
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建作品…', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '新建作品', exact: true });
  await dialog.getByRole('textbox', { name: '作品名称', exact: true }).fill('另一作品');
  await dialog.getByRole('textbox', { name: '作品存放位置', exact: true }).fill(home);
  await dialog.getByRole('button', { name: '创建并打开', exact: true }).click();
  const unsaved = page.getByRole('dialog', { name: '保存未保存的修改？', exact: true });
  await unsaved.getByRole('button', { name: '取消', exact: true }).click();
  await expect(dialog).toContainText('作品已创建');
  const root = path.join(home, '另一作品');
  const first = JSON.parse(await readFile(path.join(root, 'chaptale.json'), 'utf8'));
  await dialog.getByRole('button', { name: '打开作品', exact: true }).click();
  await unsaved.getByRole('button', { name: '保存并继续', exact: true }).click();
  await expect(page.getByRole('tab', { name: '正文/0001-第一章.md', exact: true })).toBeVisible();
  await expect(dialog).not.toBeVisible();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toContain('保留在旧作品的草稿。');
  expect(JSON.parse(await readFile(path.join(root, 'chaptale.json'), 'utf8')).id).toBe(first.id);
});

test('M6 右键菜单联动文件、标签、选区与 Agent，不自动发送', async () => {
  await openChapter();
  const content = page.getByRole('textbox', { name: '文档正文', exact: true });
  await content.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.press('Control+Shift+Home');
  await content.click({ button: 'right' });
  await page.getByRole('menuitem', { name: '与 Agent 讨论选段', exact: true }).click();
  await expect(page.getByPlaceholder('描述你的创作需求...')).toHaveValue(/雪落在窗沿/);
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await page.locator('[data-tree-path="正文/第一章.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '重命名…', exact: true }).click();
  const renameDialog = page.getByRole('dialog', { name: '重命名', exact: true });
  await renameDialog.getByRole('textbox', { name: '文件操作目标', exact: true }).fill('新章名.md');
  await renameDialog.getByRole('button', { name: '重命名', exact: true }).click();
  await expect(page.getByRole('tab', { name: '正文/新章名.md', exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace, '正文/新章名.md'), 'utf8')).toBe(chapter);
  await page.getByRole('treeitem', { name: '空文件.txt', exact: true }).click();
  await page.getByRole('tab', { name: '正文/新章名.md', exact: true }).click({ button: 'right' });
  await page.getByRole('menuitem', { name: '关闭其他标签', exact: true }).click();
  await expect(page.getByRole('tab', { name: '空文件.txt', exact: true })).toHaveCount(0);
  await page.locator('[data-tree-path="正文/新章名.md"]').click({ button: 'right' });
  await page.getByRole('menuitem', { name: '移到回收站…', exact: true }).click();
  await page
    .getByRole('dialog', { name: '移到回收站', exact: true })
    .getByRole('button', { name: '取消', exact: true })
    .click();
  expect(await readFile(path.join(workspace, '正文/新章名.md'), 'utf8')).toBe(chapter);
  await expect(page.getByRole('button', { name: '三维审查', exact: true })).toHaveCount(0);
  await expect(page.locator('.document-footer .document-words')).toBeVisible();
  await expect(page.locator('.status-bar')).toContainText('云端未知');
});

test('M6 三主题文本选择和 skill 对比度、菜单文字列对齐', async () => {
  const session = await page.evaluate(() =>
    (window as DesktopWindow).chaptaleDesktop.session.create({ name: '选区视觉检查' })
  );
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  await page.locator('.history-item-select').filter({ hasText: '选区视觉检查' }).click();
  await expect(page.getByRole('region', { name: '历史记录', exact: true })).toBeHidden();
  await expect(
    page.getByLabel('聊天工具栏').getByRole('button', { name: '重命名 选区视觉检查', exact: true })
  ).toBeVisible();
  expect(path.resolve(session.path).startsWith(path.resolve(home) + path.sep)).toBe(true);
  await app!.close();
  app = undefined;
  const persistedSettings = JSON.parse(await readFile(path.join(home, '.chaptale/settings.json'), 'utf8'));
  expect(Object.values(persistedSettings.lastSessions ?? {})).toContain(session.id);
  const records = (await readFile(session.path, 'utf8'))
    .trim()
    .split('\n')
    .map(line => JSON.parse(line));
  await appendFile(
    session.path,
    JSON.stringify({
      type: 'message',
      id: 'visual-selection-user',
      parentId: records.findLast(record => record.type !== 'session')?.id ?? null,
      timestamp: new Date().toISOString(),
      message: { role: 'user', content: '/skill:blueprint-interview 雪落在窗沿，林晚收起了信。', timestamp: Date.now() }
    }) + '\n'
  );
  await launchApp();
  const skill = page.locator('.user-message-skill');
  await expect(skill).toHaveText('blueprint-interview');
  await mkdir(visualDir, { recursive: true });
  for (const theme of ['light', 'warm', 'dark'] as const) {
    await page.evaluate(
      async value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }),
      theme
    );
    await page.reload();
    await expect(skill).toBeVisible();
    const ratios = await skill.evaluate(element => {
      const ctx = document.createElement('canvas').getContext('2d')!;
      const color = (value: string) => {
        ctx.clearRect(0, 0, 1, 1);
        ctx.fillStyle = value;
        ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const ratio = (a: string, b: string) => {
        const [x, y] = [a, b].map(value =>
          color(value)
            .map(v => v / 255)
            .map(v => (v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4))
            .reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i]!, 0)
        ) as [number, number];
        return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
      };
      const style = getComputedStyle(element);
      const selected = getComputedStyle(element, '::selection');
      return {
        skill: ratio(style.color, style.backgroundColor),
        selection: ratio(selected.color, selected.backgroundColor)
      };
    });
    expect(ratios.skill).toBeGreaterThanOrEqual(4.5);
    expect(ratios.selection).toBeGreaterThanOrEqual(4.5);
    await page.locator('.user-message').evaluate(element => {
      const selection = window.getSelection()!;
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
    });
    await page.screenshot({ path: path.join(visualDir, `m6-selection-${theme}.png`) });
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    const columns = await page
      .locator(
        '.app-menubar-content [data-item-id="file.auto-save"] .app-menubar-item-label, .app-menubar-content [data-item-id="file.save"] .app-menubar-item-label'
      )
      .evaluateAll(elements => elements.map(element => element.getBoundingClientRect().left));
    expect(columns).toHaveLength(2);
    expect(Math.abs(columns[0]! - columns[1]!)).toBeLessThan(1);
    await expect(page.getByRole('menuitem', { name: '退出', exact: true })).toHaveCount(0);
    await page.keyboard.press('Escape');
  }
});

test('资产库支持跨目录分组、关系反链、无损识别和三主题窄窗口', async () => {
  await mkdir(path.join(workspace, '角色/主要'), { recursive: true });
  await mkdir(path.join(workspace, '散落资产'));
  await mkdir(path.join(workspace, '大纲/场景卡'), { recursive: true });
  await writeFile(
    path.join(workspace, '角色/主要/林晚.md'),
    '---\nid: linwan\nkind: character\ntitle: 林晚\nimportance: main\naliases: [阿晚]\nrelations:\n  - { to: "[[顾沉]]", type: 师父, note: 尚不知其真实身份 }\n---\n在[[失落的城]]收到信。\n'
  );
  await writeFile(
    path.join(workspace, '散落资产/顾沉.md'),
    '---\nid: guchen\nkind: character\ntitle: 顾沉\nimportance: main\n---\n远行未归。\n'
  );
  await writeFile(
    path.join(workspace, '大纲/场景卡/夜访.md'),
    '---\nkind: scene-card\ntitle: 夜访\ncast: ["[[角色/主要/林晚.md]]"]\n---\n本章场景。\n'
  );
  await writeFile(path.join(workspace, '角色/林晚 (conflicted copy).md'), '同步产生的待处理副本。');
  const unclassified = '---\ncustom: 0xFF # 保留\n---\n作者的自由文字。\n';
  await writeFile(path.join(workspace, '草记.md'), unclassified);
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  const structure = page.getByRole('region', { name: '资料库导航' });
  await page.getByRole('tab', { name: '角色', exact: true }).click();
  await page.getByRole('button', { name: '分组视图', exact: true }).click();
  await expect(page.locator('.structure-group summary', { hasText: '主要角色' })).toHaveCount(1);
  await page.getByRole('button', { name: '打开资产 林晚 角色/主要/林晚.md', exact: true }).click();
  const detail = page.getByRole('region', { name: '资产详情' });
  await expect(detail.getByRole('heading', { name: '林晚', exact: true })).toBeVisible();
  await expect(detail.getByText('[[失落的城]] · 断链', { exact: false })).toBeVisible();
  await expect(detail.getByRole('button', { name: /夜访/ })).toBeVisible();
  await detail.getByRole('button', { name: '[[顾沉]]', exact: true }).first().click();
  await expect(detail.getByText('将本角色视为师父', { exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '筛选资产', exact: true }).fill('阿晚');
  await expect(page.locator('.structure-row')).toHaveCount(1);
  await page.getByRole('button', { name: '清除资产筛选' }).click();
  await page.getByRole('tab', { name: '未分类', exact: true }).click();
  await page.getByRole('button', { name: '打开资产 草记 草记.md', exact: true }).click();
  await detail.getByRole('button', { name: '识别文档', exact: true }).click();
  await expect.poll(() => readFile(path.join(workspace, '草记.md'), 'utf8')).toContain('kind: character');
  const recognized = await readFile(path.join(workspace, '草记.md'), 'utf8');
  expect(recognized).toContain('custom: 0xFF # 保留\n');
  expect(recognized.endsWith('作者的自由文字。\n')).toBe(true);
  expect(recognized).not.toContain('一句话定位');
  await expect(page.getByRole('tab', { name: '表单', exact: true })).toBeVisible();
  await expect(page.getByText('冲突待处理', { exact: false }).first()).toBeVisible();
  const snapshot = await page.evaluate(
    async root => (window as DesktopWindow).chaptaleDesktop.library.listAssets({ rootPath: root }),
    workspace
  );
  expect(snapshot.assets.some(asset => asset.sourcePath.includes('conflicted copy'))).toBe(false);
  await mkdir(visualDir, { recursive: true });
  for (const [theme, width] of [
    ['light', 1440],
    ['warm', 1024],
    ['dark', 1024]
  ] as const) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size, 800), width);
    await page.evaluate(
      async value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }),
      theme
    );
    await page.reload();
    await page.getByRole('button', { name: '资料库', exact: true }).click();
    await page.getByRole('tab', { name: '角色', exact: true }).click();
    await page.getByRole('button', { name: '分组视图', exact: true }).click();
    await page.getByRole('button', { name: '打开资产 林晚 角色/主要/林晚.md', exact: true }).click();
    await expect(detail.getByRole('heading', { name: '林晚', exact: true })).toBeVisible();
    const sizes = await page.locator('.structure-panel, .asset-panel').evaluateAll(elements =>
      elements.map(element => ({
        width: element.getBoundingClientRect().width,
        scroll: element.scrollWidth,
        right: element.getBoundingClientRect().right,
        viewport: window.innerWidth
      }))
    );
    expect(sizes.every(size => size.scroll <= size.width + 1 && size.right <= size.viewport + 1)).toBe(true);
    await page.screenshot({ path: path.join(visualDir, `m5-assets-${theme}.png`) });
  }
  await expect(structure).toBeVisible();
});

test('资产库待确认差异经真实 IPC 接受并可撤销，未接受前不写文件', async () => {
  const original = '---\nid: linwan\nkind: character\ntitle: 林晚\n---\n尚未拆信。\n';
  const modified = original.replace('尚未拆信', '已经拆信');
  await mkdir(path.join(workspace, '角色'));
  await writeFile(path.join(workspace, '角色/林晚.md'), original);
  await mkdir(path.join(workspace, '.chaptale/memory/pending'), { recursive: true });
  const fingerprint = `sha1:${createHash('sha1').update(original).digest('hex')}`;
  await writeFile(
    path.join(workspace, '.chaptale/memory/pending/p-asset.md'),
    `---\nkind: proposal\nid: p-asset\nproposalType: update\ntitle: 林晚状态\nreason: 收到来信\nsource: saved-output\ncreatedAt: "2026-09-08T00:00:00.000Z"\ntargetPath: "角色/林晚.md"\ncontentHash: "${fingerprint}"\n---\n${modified}`
  );
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  await page.getByRole('tab', { name: '角色', exact: true }).click();
  await page.getByRole('button', { name: '打开资产 林晚 角色/林晚.md', exact: true }).click();
  await page.getByRole('region', { name: '资产详情' }).getByRole('button', { name: '林晚状态', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '待确认事实', exact: true });
  await expect(dialog.getByRole('textbox', { name: '当前资产', exact: true })).toContainText('尚未拆信');
  await expect(dialog.getByRole('textbox', { name: '提议内容', exact: true })).toContainText('已经拆信');
  expect(await readFile(path.join(workspace, '角色/林晚.md'), 'utf8')).toBe(original);
  await dialog.getByRole('button', { name: '接受提议', exact: true }).click();
  await expect(dialog).toBeHidden();
  expect(await readFile(path.join(workspace, '角色/林晚.md'), 'utf8')).toBe(modified);
  await page.getByRole('textbox', { name: '文档正文' }).click();
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('尚未拆信');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(path.join(workspace, '角色/林晚.md'), 'utf8')).toBe(original);
});

test('资产库文档版本支持定稿快照、外部冲突保护、完整回滚与重启恢复', async () => {
  await openChapter();
  await page.getByRole('menuitem', { name: '写作', exact: true }).click();
  await page.getByRole('menuitem', { name: '定稿当前章节', exact: true }).click();
  const finalDialog = page.getByRole('dialog', { name: '定稿当前章节', exact: true });
  await finalDialog.getByRole('button', { name: '确认定稿', exact: true }).click();
  await expect(finalDialog).toBeHidden();
  const finalized = await readFile(path.join(workspace, '正文/第一章.md'), 'utf8');
  expect(finalized).toContain('status: final');
  const snapshots = await page.evaluate(
    async root =>
      (window as DesktopWindow).chaptaleDesktop.writing.listVersions({ rootPath: root, targetPath: '正文/第一章.md' }),
    workspace
  );
  expect(snapshots).toHaveLength(2);
  const finalSnapshot = snapshots.find(item => item.reason === 'final')!;
  expect(snapshots.some(item => item.reason === 'before-final')).toBe(true);
  const immutable = await readFile(path.join(workspace, finalSnapshot.contentPath), 'utf8');
  expect(immutable).toBe(finalized);
  await writeFile(path.join(workspace, '正文/第一章.md'), `${finalized}后来的修改。\r\n`);
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('后来的修改');
  await page.getByRole('button', { name: '查看文档版本', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '文档版本', exact: true });
  await expect(dialog.getByRole('textbox', { name: '当前版本', exact: true })).toContainText('后来的修改');
  const external = `${finalized}外部再次修改。\r\n`;
  await writeFile(path.join(workspace, '正文/第一章.md'), external);
  await expect(page.getByRole('textbox', { name: '文档正文' })).toContainText('外部再次修改');
  await dialog.getByRole('button', { name: '回滚到该版本', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('已变化');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(external);
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await page.getByRole('button', { name: '查看文档版本', exact: true }).click();
  await expect(dialog.getByRole('textbox', { name: '当前版本', exact: true })).toContainText('外部再次修改');
  await dialog.getByRole('button', { name: '回滚到该版本', exact: true }).click();
  await expect(dialog.getByText('当前文件与此快照一致', { exact: true })).toBeVisible();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(finalized);
  expect(await readFile(path.join(workspace, finalSnapshot.contentPath), 'utf8')).toBe(immutable);
  const restored = await page.evaluate(
    async root =>
      (window as DesktopWindow).chaptaleDesktop.writing.listVersions({ rootPath: root, targetPath: '正文/第一章.md' }),
    workspace
  );
  expect(restored.map(item => item.reason)).toEqual(expect.arrayContaining(['before-rollback', 'rollback', 'final']));
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'm5-version-restored.png') });
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await app!.close();
  await launchApp();
  await openChapter();
  await page.getByRole('button', { name: '查看文档版本', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: '文档版本', exact: true }).getByRole('combobox', { name: '历史版本' })
  ).toContainText('回滚');
});

test('结算提议经真实 IPC 编辑接受、拒绝和重启恢复，完成后更新场景', async () => {
  const characterPath = '角色/林晚.md';
  const character = '---\nid: linwan\nkind: character\ntitle: 林晚\ncustom: 0xFF # 保留\n---\n尚未拆信。\n';
  const scenePath = '大纲/场景卡/夜访.md';
  const scene =
    '---\nkind: scene-card\ntitle: 夜访\nchapter: "[[正文/第一章.md]]"\nsettled: false\n---\n在桥下交换来信。\n';
  await mkdir(path.join(workspace, '角色'));
  await mkdir(path.join(workspace, '大纲/场景卡'), { recursive: true });
  await writeFile(path.join(workspace, characterPath), character);
  await writeFile(path.join(workspace, scenePath), scene);
  const chapterKey = hash('path:正文/第一章.md').slice(0, 24);
  const summaryPath = `.chaptale/memory/summaries/chapters/${chapterKey}.md`;
  const batch: SettlementBatch = {
    id: 'settlement-fixture',
    revision: 1,
    status: 'ready',
    chapterPath: '正文/第一章.md',
    chapterKey,
    chapterHash: hash(chapter),
    chapterTitle: '初雪',
    packId: 'saved-pack',
    personaId: 'chapter-distiller',
    model: { provider: 'fixture', modelId: 'saved-output' },
    autoAcceptSummary: false,
    worldDirectory: '设定',
    sources: [
      { sourcePath: characterPath, contentHash: hash(character), kind: 'character' },
      { sourcePath: scenePath, contentHash: hash(scene), kind: 'scene-card' }
    ],
    scenes: [{ sourcePath: scenePath, contentHash: hash(scene), kind: 'scene-card' }],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    items: [
      {
        id: 'summary',
        category: 'summary',
        title: '章节摘要',
        reason: '本章事实',
        targetPath: summaryPath,
        proposedContent: '---\nkind: chapter-summary\n---\n林晚收到来信。\n',
        status: 'pending'
      },
      {
        id: 'asset-0',
        category: 'character',
        title: '林晚',
        reason: '已收到信',
        targetPath: characterPath,
        baseline: { content: character, contentHash: hash(character) },
        proposedContent: character.replace('尚未拆信', '已经拆信'),
        status: 'pending'
      },
      {
        id: 'event-0',
        category: 'timeline',
        title: '拆开来信',
        reason: '待确认事件',
        targetPath: '设定/时间线/settlement-fixture-event-0.md',
        proposedContent: '---\nkind: world\n---\n拆开来信。\n',
        status: 'pending'
      }
    ]
  };
  await mkdir(path.join(workspace, '.chaptale/memory/pending/batches'), { recursive: true });
  await writeFile(
    path.join(workspace, '.chaptale/memory/pending/batches/settlement-fixture.json'),
    JSON.stringify(batch)
  );
  await page.getByRole('tab', { name: '结算', exact: true }).click();
  await page.getByRole('button', { name: /初雪.*3 项待确认/ }).click();
  const dialog = page.getByRole('dialog', { name: '结算批次' });
  await expect(dialog.getByRole('textbox', { name: '待确认内容' })).toContainText('林晚收到来信');
  expect(await readFile(path.join(workspace, characterPath), 'utf8')).toBe(character);
  await dialog.getByRole('button', { name: '接受提议', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: '结算提议' })).toContainText('已接受');
  expect(await readFile(path.join(workspace, summaryPath), 'utf8')).toContain('林晚收到来信');
  await dialog.getByRole('combobox', { name: '结算提议' }).click();
  await page.getByRole('option', { name: '角色状态 · 林晚 · 待确认', exact: true }).click();
  await dialog.getByRole('button', { name: '编辑提议', exact: true }).click();
  await dialog
    .getByRole('textbox', { name: '编辑待确认事实' })
    .fill(character.replace('尚未拆信。', '仍未拆信，保管在袖口。'));
  await dialog.getByRole('button', { name: '编辑后接受', exact: true }).click();
  await expect
    .poll(() => readFile(path.join(workspace, characterPath), 'utf8'))
    .toBe(character.replace('尚未拆信。', '仍未拆信，保管在袖口。'));
  await dialog.getByRole('combobox', { name: '结算提议' }).click();
  await page.getByRole('option', { name: '时间线事件 · 拆开来信 · 待确认', exact: true }).click();
  await dialog.getByRole('button', { name: '拒绝提议', exact: true }).click();
  await dialog.getByRole('button', { name: '完成结算', exact: true }).click();
  await expect(dialog.getByText('本章结算已完成')).toBeVisible();
  await expect.poll(() => readFile(path.join(workspace, scenePath), 'utf8')).toContain('settled: true');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await expect(readFile(path.join(workspace, '设定/时间线/settlement-fixture-event-0.md'))).rejects.toMatchObject({
    code: 'ENOENT'
  });
  expect(await readFile(path.join(workspace, '.chaptale/memory/summaries/recent.md'), 'utf8')).toContain(
    '林晚收到来信'
  );
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'm5-settlement-completed.png') });
  await dialog.getByRole('button', { name: '关闭', exact: true }).last().click();
  await app!.close();
  await launchApp();
  await page.getByRole('tab', { name: '结算', exact: true }).click();
  await page.getByRole('combobox', { name: '结算状态筛选' }).click();
  await page.getByRole('option', { name: '全部结算', exact: true }).click();
  await page.getByRole('button', { name: /初雪.*已结算/ }).click();
  await expect(page.getByRole('dialog', { name: '结算批次' }).getByText('本章结算已完成')).toBeVisible();
});

test('结算准备补齐场景参考并统计未结算章节，无模型时不发送请求', async () => {
  await mkdir(path.join(workspace, '大纲/场景卡'), { recursive: true });
  await mkdir(path.join(workspace, '角色'));
  await writeFile(path.join(workspace, '角色/林晚.md'), '---\nkind: character\ntitle: 林晚\n---\n尚未拆信。\n');
  await writeFile(
    path.join(workspace, '大纲/场景卡/夜访.md'),
    '---\nkind: scene-card\nchapter: "[[正文/第一章.md]]"\ncast: ["[[角色/林晚.md]]"]\n---\n收到来信。\n'
  );
  for (const name of ['第二章', '第三章'])
    await writeFile(path.join(workspace, `正文/${name}.md`), `# ${name}\n已保存的正文。\n`);
  await expect
    .poll(() =>
      page.evaluate(
        async root => (await (window as DesktopWindow).chaptaleDesktop.settlement.unsettled({ rootPath: root })).length,
        workspace
      )
    )
    .toBe(3);
  const plan = await page.evaluate(async root => {
    const api = (window as DesktopWindow).chaptaleDesktop;
    const pack = await api.library.freezePack({ rootPath: root, goal: '结算准备', budgetChars: 9000, selections: [] });
    return api.settlement.prepare({ rootPath: root, chapterPath: '正文/第一章.md', packId: pack.id });
  }, workspace);
  expect(plan.sources).toContain('角色/林晚.md');
  expect(plan.scenePaths).toEqual(['大纲/场景卡/夜访.md']);
  await openChapter();
  await page.getByRole('menuitem', { name: '写作', exact: true }).click();
  await page.getByRole('menuitem', { name: '结算当前章节', exact: true }).click();
  const confirmation = page.getByRole('dialog', { name: '结算本章' });
  await expect(confirmation.getByRole('checkbox', { name: '本次自动接受摘要' })).not.toBeChecked();
  await expect(confirmation.getByRole('button', { name: '生成待确认事实' })).toBeDisabled();
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
});

test('通用表单在三种主题与窄窗口中保持可读尺寸，搜索选择不丢自由输入', async () => {
  for (const [theme, width] of [
    ['light', 1440],
    ['warm', 1024],
    ['dark', 1024]
  ] as const) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size, 800), width);
    await page.evaluate(async value => {
      await (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value });
    }, theme);
    await page.reload();
    const statusColors = await page.evaluate(() => {
      const styles = getComputedStyle(document.documentElement);
      return ['--warning', '--success', '--info'].map(name => styles.getPropertyValue(name).trim());
    });
    expect(statusColors.every(color => color.length > 0)).toBe(true);
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await page.getByRole('menuitem', { name: '新建场景卡', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: '新建场景卡', exact: true });
    await expect(dialog.getByRole('textbox', { name: /^标题/ })).toBeVisible();
    const sizes = await dialog
      .locator('.app-input-control, .app-select-trigger, .app-combobox-input, .app-number-input-control, .app-textarea')
      .evaluateAll(elements =>
        elements.map(element => {
          const style = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          const control =
            element.closest('[data-slot="app-input"], [data-slot="app-combobox"], [data-slot="app-number-input"]') ??
            element;
          return {
            font: Number.parseFloat(style.fontSize),
            height: control.getBoundingClientRect().height,
            left: box.left,
            right: box.right,
            viewport: window.innerWidth
          };
        })
      );
    expect(sizes.length).toBeGreaterThan(8);
    for (const size of sizes) {
      expect(size.font).toBeGreaterThanOrEqual(13);
      expect(size.height).toBeGreaterThanOrEqual(32);
      expect(size.left).toBeGreaterThanOrEqual(0);
      expect(size.right).toBeLessThanOrEqual(size.viewport);
    }
    const chapterLink = dialog.getByRole('combobox', { name: '所属章节', exact: true });
    await chapterLink.fill('初雪');
    const option = page.getByRole('option', { name: /初雪/ });
    await expect(option).toBeVisible();
    await option.click();
    await expect(chapterLink).toHaveValue('[[正文/第一章.md]]');
    await chapterLink.fill('[[作者手输的新章节]]');
    await dialog.getByRole('textbox', { name: /^标题/ }).click();
    await expect(chapterLink).toHaveValue('[[作者手输的新章节]]');
    await dialog.getByRole('spinbutton', { name: '目标字数' }).fill('2400');
    await page.keyboard.press('ArrowUp');
    await expect(dialog.getByRole('spinbutton', { name: '目标字数' })).toHaveValue('2401');
    await dialog.getByRole('checkbox', { name: '已结算' }).check();
    await expect(dialog.getByRole('checkbox', { name: '已结算' })).toBeChecked();
    await dialog.getByRole('textbox', { name: /^标题/ }).scrollIntoViewIfNeeded();
    await mkdir(visualDir, { recursive: true });
    await page.screenshot({ path: path.join(visualDir, `ui-controls-${theme}-${width}.png`) });
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    expect((await readdir(workspace)).some(name => name === '大纲')).toBe(false);
  }
  await page.getByRole('button', { name: '历史记录', exact: true }).click();
  const search = page.getByRole('searchbox', { name: '搜索历史记录' });
  const height = () => search.evaluate(element => element.closest('.app-input')!.getBoundingClientRect().height);
  await expect(search).toBeVisible();
  const before = await height();
  await search.fill('长标题筛选');
  await expect(page.getByRole('button', { name: '清空搜索', exact: true })).toBeVisible();
  expect(await height()).toBe(before);
  await page.getByRole('button', { name: '清空搜索', exact: true }).click();
  expect(await height()).toBe(before);
  await page.screenshot({ path: path.join(visualDir, 'ui-history-controls.png') });
});

test('历史、设置和菜单遵守统一字号，长模型名称不与操作重叠', async () => {
  test.setTimeout(60_000);
  await page.evaluate(async root => {
    const api = (window as DesktopWindow).chaptaleDesktop;
    await api.session.create({ cwd: root, name: '排版校验：一个很长的创作会话标题，需要保持时间和操作清晰可见' });
    await api.models.addCustomProvider({
      provider: 'layout-check',
      providerName: '排版校验服务',
      baseUrl: 'https://example.invalid/v1',
      api: 'openai-completions',
      models: [
        { modelId: 'draft-long-name', modelName: '长篇写作与人物连续性校验模型'.repeat(3), input: ['text'] },
        { modelId: 'review', modelName: '独立审查', input: ['text'] }
      ]
    });
    await api.models.setDefault({ provider: 'layout-check', modelId: 'draft-long-name' });
  }, workspace);
  await mkdir(visualDir, { recursive: true });

  async function expectSizing(selector: string, font: number, height = 0) {
    const sizes = await page.locator(selector).evaluateAll(elements =>
      elements
        .filter(element => element.getClientRects().length && getComputedStyle(element).visibility !== 'hidden')
        .map(element => {
          const box = element.getBoundingClientRect();
          return {
            font: Number.parseFloat(getComputedStyle(element).fontSize),
            height: box.height,
            left: box.left,
            right: box.right,
            viewport: window.innerWidth
          };
        })
    );
    expect(sizes.length).toBeGreaterThan(0);
    for (const size of sizes) {
      expect(size.font).toBeGreaterThanOrEqual(font);
      expect(size.height).toBeGreaterThanOrEqual(height);
      expect(size.left).toBeGreaterThanOrEqual(0);
      expect(size.right).toBeLessThanOrEqual(size.viewport);
    }
  }

  for (const [theme, width] of [
    ['light', 1440],
    ['warm', 1024],
    ['dark', 1024]
  ] as const) {
    await app!.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0]!.setSize(size, 800), width);
    await page.evaluate(async value => {
      await (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value });
    }, theme);
    await page.reload();
    await page.getByRole('menuitem', { name: '文件', exact: true }).click();
    await expectSizing('.app-menubar-item', 13, 32);
    await expectSizing('.app-menubar-shortcut', 12);
    await page.screenshot({ path: path.join(visualDir, `ui-menubar-${theme}.png`) });
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '选择本轮推理档位', exact: true }).click();
    await expect(page.getByRole('menuitem', { name: '跟随模型', exact: true })).toBeVisible();
    await expectSizing('.app-dropdown-item', 13, 32);
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    expect(
      await page.locator('.settings-panel').evaluate(element => getComputedStyle(element).backgroundColor)
    ).not.toContain('rgba');
    const categories = page.getByRole('navigation', { name: '设置分类' });
    await categories.getByRole('button', { name: /^模型/ }).click();
    await page.locator('.settings-provider-card').filter({ hasText: '排版校验服务' }).click();
    await expect(page.locator('.settings-default-badge')).toBeVisible();
    await expectSizing('.settings-provider-name, .settings-model-copy strong', 13);
    await expectSizing('.settings-default-badge, .settings-provider-meta', 12);
    const rows = await page.locator('.settings-model-row').evaluateAll(elements =>
      elements.map(element => ({
        copyBottom: element.querySelector('.settings-model-copy')!.getBoundingClientRect().bottom,
        actionsTop: element.querySelector('.settings-model-actions')!.getBoundingClientRect().top
      }))
    );
    expect(rows).toHaveLength(2);
    for (const row of rows) expect(row.actionsTop).toBeGreaterThanOrEqual(row.copyBottom);
    await page.locator('.settings-model-row').first().scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(visualDir, `ui-model-settings-${theme}.png`) });

    await categories.getByRole('button', { name: /^Prompt/ }).click();
    await page.locator('.prompt-settings-inline-actions').first().scrollIntoViewIfNeeded();
    await expectSizing('.prompt-settings-inline-actions code', 12);
    await page.screenshot({ path: path.join(visualDir, `ui-prompt-settings-${theme}.png`) });
    await page.getByRole('button', { name: '关闭设置', exact: true }).click();

    await page.getByRole('button', { name: '历史记录', exact: true }).click();
    await page.getByRole('searchbox', { name: '搜索历史记录' }).fill('排版校验');
    await expect(page.locator('.history-item-title')).toHaveCount(1);
    await expectSizing('.history-item-title, .history-item-preview', 13);
    await expectSizing('.history-item-time, .history-item-workspace, .history-item-stats', 12);
    await expectSizing('.history-control', 13, 32);
    await page.screenshot({ path: path.join(visualDir, `ui-history-${theme}.png`) });
    await page.locator('.history-item-select').click();
  }
});

test('场景模板创建、表单无损保存及场景参考通过真实 IPC 串联', async () => {
  await writeFile(
    path.join(workspace, '正文/第一章.md'),
    chapter.replace('title: 初雪', 'id: chapter-one\r\nkind: chapter\r\norder: 1\r\ntitle: 初雪')
  );
  await mkdir(path.join(workspace, '角色'));
  await writeFile(
    path.join(workspace, '角色/林晚.md'),
    '---\nkind: character\ntitle: 林晚\nstatus: active\n---\n## 当前状态\n尚未拆信。\n'
  );
  await page.getByRole('menuitem', { name: '文件', exact: true }).click();
  await page.getByRole('menuitem', { name: '新建场景卡', exact: true }).click();
  const create = page.getByRole('dialog', { name: '新建场景卡', exact: true });
  await create.getByRole('textbox', { name: /^标题/ }).fill('夜访');
  await create.getByRole('textbox', { name: '场景目标', exact: true }).fill('收到来信');
  await create.getByRole('combobox', { name: '所属章节', exact: true }).fill('[[正文/第一章.md]]');
  await create.getByRole('combobox', { name: '添加出场角色', exact: true }).click();
  await page.getByRole('option', { name: /林晚.*角色\/林晚\.md/ }).click();
  await expect(create.getByRole('textbox', { name: '出场角色', exact: true })).toHaveValue('[[角色/林晚.md]]');
  await create.getByRole('button', { name: '创建文件', exact: true }).click();
  const scenePath = '大纲/场景卡/夜访.md';
  await expect(page.getByRole('tab', { name: scenePath, exact: true })).toBeVisible();
  const filename = path.join(workspace, scenePath);
  const created = await readFile(filename, 'utf8');
  const custom = '# 不属于模板的字段\ncustom: { values: [甲, 乙], number: 0xFF } # 保留\n';
  const withUnknown = created.replace('\n---\n', `\n${custom}---\n`);
  await writeFile(filename, withUnknown);
  await page.getByRole('button', { name: '重新读取', exact: true }).click();
  await page.getByRole('tab', { name: '表单', exact: true }).click();
  const form = page.locator('.document-form');
  await form.getByRole('textbox', { name: '场景目标', exact: true }).fill('在桥下交换来信');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(filename, 'utf8')).toContain('goal: 在桥下交换来信');
  const saved = await readFile(filename, 'utf8');
  expect(saved).toContain(custom);
  expect(saved.split('\n---\n')[1]).toBe(withUnknown.split('\n---\n')[1]);
  await form.getByRole('button', { name: '组装本次参考', exact: true }).click();
  const references = page.getByRole('region', { name: '本次写作参考', exact: true });
  await expect(references.getByRole('textbox', { name: '写作目标', exact: true })).toHaveValue('在桥下交换来信');
  await expect(references.getByRole('button', { name: '林晚', exact: true })).toBeVisible();
  await references.getByRole('button', { name: '固定 林晚', exact: true }).click();
  await references.getByRole('button', { name: '重组参考', exact: true }).click();
  await expect(references.getByRole('button', { name: '取消固定 林晚', exact: true })).toBeVisible();
  await references.getByRole('button', { name: '冻结参考', exact: true }).click();
  await expect(references.getByText(/已冻结/)).toBeVisible();
  const characterSource = references.locator('.reference-item').filter({
    has: page.getByRole('button', { name: '林晚', exact: true })
  });
  const preview = characterSource.locator('.app-text-view .cm-content');
  await expect(preview).toHaveCount(0);
  await characterSource.getByRole('button', { name: '原文', exact: true }).click();
  await expect(preview).toContainText('尚未拆信');
  await expect(preview).toHaveCSS('font-size', '14px');
  await expect(preview).toHaveAttribute('contenteditable', 'false');
  await mkdir(visualDir, { recursive: true });
  await preview.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(visualDir, 'ui-reference-source.png') });
  await characterSource.getByRole('button', { name: '原文', exact: true }).click();
  await expect(preview).toHaveCount(0);
  await page.screenshot({ path: path.join(visualDir, 'm5-scene-reference.png') });
});

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
  await page.getByRole('combobox', { name: '问题处理状态' }).click();
  await page.getByRole('option', { name: '已忽略', exact: true }).click();
  await expect(page.getByRole('button', { name: '重新打开', exact: true })).toBeVisible();
});

test('审查偏好必须经作者确认，通用表单在三主题可读且重启保留', async () => {
  test.setTimeout(60_000);
  const reviewDir = path.join(workspace, '.chaptale/reviews');
  await mkdir(path.join(reviewDir, 'jobs'), { recursive: true });
  const output = JSON.stringify({
    summary: '五处节奏建议',
    issues: Array.from({ length: 5 }, (_, index) => ({
      agentType: 'style',
      type: 'flat_rhythm',
      severity: 'low',
      quote: '林晚收起了信',
      reason: `节奏问题 ${index + 1}`,
      suggestion: `检查句式 ${index + 1}`
    }))
  });
  await writeFile(path.join(reviewDir, 'feedback-fixture.json'), output);
  await writeFile(
    path.join(reviewDir, 'jobs/feedback-job.json'),
    JSON.stringify({
      id: 'feedback-job',
      personaId: 'style-reviewer',
      targetPath: '正文/第一章.md',
      text: chapter.replace(/\r\n/g, '\n'),
      baselineHash: hash(chapter),
      model: { provider: 'fixture', modelId: 'stored-output' },
      memoryRefs: [],
      excludedSources: [],
      status: 'done',
      runId: 'feedback-fixture',
      outputRef: '.chaptale/reviews/feedback-fixture.json',
      outputHash: hash(output),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString()
    })
  );
  await page.getByRole('button', { name: '审查', exact: true }).click();
  await page.getByRole('button', { name: /正文\/第一章.md.*文风.*已完成/ }).click();
  const panel = page.getByRole('region', { name: '独立审查' });
  for (let remaining = 5; remaining > 0; remaining--) {
    await panel.getByRole('button', { name: '忽略', exact: true }).first().click();
    await expect(panel.locator('.review-issue-row')).toHaveCount(remaining - 1);
  }
  const feedback = page.getByRole('region', { name: '审查偏好', exact: true });
  await expect(feedback).toContainText('已连续忽略 5 条不同问题');
  await feedback.getByRole('button', { name: '调整检查', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '确认审查偏好', exact: true });
  await expect(dialog.getByRole('textbox', { name: '审查偏好内容' })).toHaveValue(/降低/);
  await dialog.getByRole('button', { name: '取消', exact: true }).click();
  const before = await page.evaluate(
    rootPath => (window as DesktopWindow).chaptaleDesktop.reviews.feedback({ rootPath }),
    workspace
  );
  expect(before.preferences).toEqual([]);
  await feedback.getByRole('button', { name: '调整检查', exact: true }).click();
  const preference = '仅对影响叙事的节奏问题提出建议，保留严重问题。';
  await dialog.getByRole('textbox', { name: '审查偏好内容' }).fill(preference);
  await mkdir(visualDir, { recursive: true });
  for (const theme of ['light', 'warm', 'dark'] as const) {
    await dialog.getByRole('button', { name: '取消', exact: true }).click();
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    await page.reload();
    await expect(page.locator('html')).toHaveClass(theme === 'dark' ? /dark/ : new RegExp(`theme-${theme}`));
    await page.getByRole('button', { name: '审查', exact: true }).click();
    await page.getByRole('button', { name: /正文\/第一章.md.*文风.*已完成/ }).click();
    await feedback.getByRole('button', { name: '调整检查', exact: true }).click();
    await dialog.getByRole('textbox', { name: '审查偏好内容' }).fill(preference);
    const metrics = await dialog.getByRole('textbox', { name: '审查偏好内容' }).evaluate(element => ({
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      right: element.getBoundingClientRect().right,
      viewport: window.innerWidth
    }));
    expect(metrics.fontSize).toBeGreaterThanOrEqual(13);
    expect(metrics.right).toBeLessThanOrEqual(metrics.viewport);
    await page.screenshot({ path: path.join(visualDir, `m5-review-feedback-${theme}.png`) });
  }
  await dialog.getByRole('button', { name: '确认偏好', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(feedback.getByRole('button', { name: '调整检查', exact: true })).toHaveCount(0);
  await feedback.locator('summary').click();
  await expect(feedback).toContainText(preference);
  expect(await readFile(path.join(reviewDir, 'feedback-fixture.json'), 'utf8')).toBe(output);
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
  await app!.close();
  app = undefined;
  await launchApp();
  await page.getByRole('button', { name: '审查', exact: true }).click();
  await page.getByRole('button', { name: /正文\/第一章.md.*文风.*已完成/ }).click();
  const restoredFeedback = page.getByRole('region', { name: '审查偏好', exact: true });
  await restoredFeedback.locator('summary').click();
  await expect(restoredFeedback).toContainText(preference);
});

test('运行追溯读取跨年记录与冻结来源，拒绝变更输出并保持三主题一致', async () => {
  test.setTimeout(60_000);
  const frozen = await page.evaluate(
    rootPath =>
      (window as DesktopWindow).chaptaleDesktop.library.freezePack({
        rootPath,
        goal: '冻结旧年创作参考',
        budgetChars: 9000,
        selections: [{ sourcePath: '设定/第一章.md', pinned: true, mode: 'full' }]
      }),
    workspace
  );
  const outputs = path.join(workspace, '.chaptale/runs/outputs');
  await mkdir(outputs, { recursive: true });
  const raw = JSON.stringify({ runId: 'old-run', rawText: '留档候选：窗沿的雪已经融了。' });
  await writeFile(path.join(outputs, 'old-run.json'), raw);
  await writeFile(
    path.join(workspace, '.chaptale/runs/agent-runs-2020-01.jsonl'),
    JSON.stringify({
      id: 'old-run',
      personaId: 'draft',
      execution: 'task',
      trigger: 'ui-action',
      promptTemplateHash: 'a'.repeat(64),
      model: { provider: 'offline-fixture', modelId: 'stored-output' },
      cachePolicy: 'provider-default',
      inputDigest: { brief: '旧年候选', files: ['正文/第一章.md'], packId: frozen.id },
      outputRef: '.chaptale/runs/outputs/old-run.json',
      outputHash: hash(raw),
      memoryRefs: [`设定/第一章.md#${hash('设定中的同名文件')}`],
      status: 'success',
      usage: { inputTokens: 1234, outputTokens: 234, cache: { readTokens: 600, writeTokens: 0, partial: true } },
      createdAt: '2020-01-01T00:00:00.000Z',
      completedAt: '2020-01-01T00:01:00.000Z'
    }) + '\n'
  );
  await page.getByRole('tab', { name: '运行', exact: true }).click();
  const history = page.getByRole('region', { name: '运行记录', exact: true });
  await history.getByRole('textbox', { name: '搜索运行记录' }).fill('old-run');
  await expect(history.getByRole('button', { name: /旧年候选/ })).toHaveCount(1);
  await history.getByRole('combobox', { name: '运行状态', exact: true }).click();
  await page.getByRole('option', { name: '失败', exact: true }).click();
  await expect(history.getByText('没有符合条件的运行记录', { exact: true })).toBeVisible();
  await history.getByRole('combobox', { name: '运行状态', exact: true }).click();
  await page.getByRole('option', { name: '全部状态', exact: true }).click();
  await history.getByRole('button', { name: /旧年候选/ }).click();
  const dialog = page.getByRole('dialog', { name: '运行详情', exact: true });
  await expect(dialog).toContainText('offline-fixture / stored-output');
  await expect(dialog).toContainText('1234 / 234 tokens');
  await expect(dialog.getByRole('region', { name: '运行用量明细' })).toContainText('600 tokens');
  await expect(dialog.getByRole('region', { name: '运行用量明细' })).toContainText('0 tokens');
  await expect(dialog.getByRole('region', { name: '运行用量明细' })).toContainText('未返回');
  await expect(dialog.getByRole('region', { name: '运行用量明细' })).toContainText('已报告部分');
  await expect(dialog.getByRole('region', { name: '运行读取来源' })).toContainText(hash('设定中的同名文件'));
  await dialog.locator('summary').click();
  await expect(dialog.getByRole('region', { name: '运行参考快照' })).toContainText('设定中的同名文件');
  await expect(dialog.getByRole('region', { name: '运行原始输出' })).toContainText('留档候选：窗沿的雪已经融了。');
  await mkdir(visualDir, { recursive: true });
  for (const theme of ['light', 'warm', 'dark'] as const) {
    await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    await app!.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1024, 800));
    await page.reload();
    await page.getByRole('tab', { name: '运行', exact: true }).click();
    await history.getByRole('button', { name: /旧年候选/ }).click();
    await expect(dialog.getByRole('region', { name: '运行原始输出' })).toContainText('留档候选');
    const metrics = await dialog.locator('.run-details').evaluate(element => ({
      fontSize: Number.parseFloat(getComputedStyle(element).fontSize),
      width: element.getBoundingClientRect().width,
      scrollWidth: element.scrollWidth
    }));
    expect(metrics.fontSize).toBeGreaterThanOrEqual(13);
    expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.width + 1);
    await page.screenshot({ path: path.join(visualDir, `m5-run-details-${theme}.png`) });
    const output = dialog.locator('.app-text-view').last();
    await output.scrollIntoViewIfNeeded();
    await expect(output.locator('.cm-editor')).toHaveCSS('font-size', '14px');
    await expect(output.locator('.cm-content')).toHaveAttribute('contenteditable', 'false');
    await page.screenshot({ path: path.join(visualDir, `m5-run-output-${theme}.png`) });
  }
  await dialog.getByRole('button', { name: '关闭', exact: true }).click();
  await writeFile(path.join(outputs, 'old-run.json'), JSON.stringify({ runId: 'old-run', rawText: '外部替换的输出' }));
  await history.getByRole('button', { name: /旧年候选/ }).click();
  await expect(dialog.getByRole('alert')).toContainText('输出内容已变化');
  await expect(dialog).not.toContainText('外部替换的输出');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toBe(chapter);
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
