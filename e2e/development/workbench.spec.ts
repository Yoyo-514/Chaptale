import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktop = path.resolve('apps/desktop');
const requireDesktop = createRequire(path.join(desktop, 'package.json'));
const visualDir = path.resolve('temp/visual-qa', `development-${Date.now()}`);
let app: ElectronApplication | undefined;
let page: Page;
let home: string;
let workspace: string;
let diagnostics: string[];
let errors: string[];

test.beforeEach(async () => {
  diagnostics = [];
  errors = [];
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-development-e2e-'));
  workspace = path.join(home, 'work');
  await mkdir(path.join(workspace, '正文'), { recursive: true });
  await writeFile(path.join(workspace, '正文/第一章.md'), '# 第一章\n\n开发态也应当显示的正文。\n');
  await writeFile(path.join(workspace, '正文/第二章.md'), '# 第二章\n\n另一份正文。\n');
  await mkdir(path.join(workspace, '角色'));
  await writeFile(
    path.join(workspace, '角色/林晚.md'),
    '---\nid: linwan\nkind: character\ntitle: 林晚\n---\n远行的人。\n'
  );
  app = await electron.launch({
    executablePath: requireDesktop('electron') as string,
    args: [desktop, `--user-data-dir=${path.join(home, 'user-data')}`],
    env: {
      ...process.env,
      HOME: home,
      USERPROFILE: home,
      NODE_ENV: 'production',
      VITE_DEV_SERVER_URL: 'http://localhost:4318'
    }
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'warning' || message.type() === 'error')
      diagnostics.push(`${message.type()}: ${message.text()}`);
  });
  await page.evaluate(async root => {
    await (window as Window & { chaptaleDesktop: ChaptaleDesktopApi }).chaptaleDesktop.settings.update({
      storage: { mode: 'workspace', workspacePath: root },
      onboarding: { completedVersion: 1 }
    });
  }, workspace);
  await page.reload();
  await expect(page.getByRole('tree', { name: '工作区文件树' })).toBeVisible();
});

test.afterEach(async () => {
  await test.info().attach('renderer-diagnostics', {
    body: JSON.stringify({ diagnostics, errors }, null, 2),
    contentType: 'application/json'
  });
  try {
    try {
      if (page && !page.isClosed()) {
        await mkdir(visualDir, { recursive: true });
        await page.screenshot({ path: path.join(visualDir, `${test.info().testId}.png`), timeout: 5000 });
      }
    } finally {
      await app?.close();
      app = undefined;
    }
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home).startsWith('chaptale-development-e2e-')).toBe(true);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
  expect(diagnostics.filter(message => message.startsWith('error:') || message.includes('[Vue warn]'))).toEqual([]);
});

test('开发态正文挂载、切换与返回保留内容', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.locator('[data-tree-path="正文/第一章.md"]').click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await expect(body).toContainText('开发态也应当显示的正文');
  await expect(body).toBeVisible();
  await page.locator('[data-tree-path="正文/第二章.md"]').click();
  await expect(body).toContainText('另一份正文');
  await page.getByRole('tab', { name: '正文/第一章.md', exact: true }).click();
  await expect(body).toContainText('开发态也应当显示的正文');
  await body.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '与 Agent 讨论此文件' })).toBeVisible();
  await page.keyboard.press('Escape');
});

test('开发态侧栏切换互斥并保留文件树展开状态', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.getByRole('button', { name: '审查', exact: true }).click();
  await expect(page.getByRole('region', { name: '审查中心', exact: true })).toBeVisible();
  await expect(page.getByRole('tree', { name: '工作区文件树' })).toBeHidden();
  await page.getByRole('button', { name: '工作区', exact: true }).click();
  await expect(page.locator('[data-tree-path="正文/第一章.md"]')).toBeVisible();
  await expect(page.getByRole('region', { name: '审查中心', exact: true })).toHaveCount(0);
});

test('三主题菜单使用柔和边框，活动栏底部保持独立间距', async () => {
  const agent = await page.getByRole('button', { name: '切换 Agent 面板', exact: true }).boundingBox();
  const settings = await page.getByRole('button', { name: '打开设置', exact: true }).boundingBox();
  expect(agent).not.toBeNull();
  expect(settings).not.toBeNull();
  expect(settings!.y - agent!.y - agent!.height).toBeGreaterThanOrEqual(4);
  for (const [label, theme] of [
    ['浅色', 'theme-light'],
    ['暖色', 'theme-warm'],
    ['深色', 'dark']
  ] as const) {
    await page.getByRole('menuitem', { name: '视图', exact: true }).click();
    await page.getByRole('menuitem', { name: '外观', exact: true }).focus();
    await page.keyboard.press('ArrowRight');
    await page.getByRole('menuitem', { name: label, exact: true }).click();
    await expect(page.locator('html')).toHaveClass(new RegExp(theme));
    await page.getByRole('treeitem', { name: '正文', exact: true }).click({ button: 'right' });
    const menu = page.getByRole('menu', { exact: true });
    await expect(menu).toBeVisible();
    const colors = await menu.evaluate(element => {
      const style = getComputedStyle(element);
      return { text: style.color, border: style.borderTopColor, shadow: style.boxShadow };
    });
    expect(colors.border).not.toBe(colors.text);
    expect(colors.shadow).not.toBe('none');
    await mkdir(visualDir, { recursive: true });
    await page.screenshot({ path: path.join(visualDir, `context-menu-${theme}.png`) });
    await page.keyboard.press('Escape');
  }
});

test('资料库视图按需打开为工作标签，关闭后保留正文草稿与撤销', async () => {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.locator('[data-tree-path="正文/第一章.md"]').click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await body.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.insertText('尚未保存的段落。');
  await expect(page.getByRole('tablist', { name: '作品视图', exact: true })).toHaveCount(0);
  await expect(page.getByRole('tab', { name: '角色关系', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '资料库', exact: true }).click();
  const graphIcon = page.getByRole('button', { name: '打开角色关系', exact: true }).locator('[aria-hidden="true"]');
  await expect.poll(() => graphIcon.evaluate(element => getComputedStyle(element).maskImage)).not.toBe('none');
  await page.getByRole('button', { name: '打开角色关系', exact: true }).click();
  await expect(page.locator('.character-node')).toHaveCount(1);
  const graphTab = page.getByRole('tab', { name: '角色关系', exact: true });
  await expect(graphTab).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('button', { name: '打开角色关系', exact: true }).click();
  await expect(graphTab).toHaveCount(1);
  await page.keyboard.press('Control+s');
  expect(await readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).not.toContain('尚未保存');
  await page.keyboard.press('Control+w');
  await expect(graphTab).toHaveCount(0);
  await expect(body).toContainText('尚未保存的段落');
  await body.click();
  await page.keyboard.press('Control+z');
  await expect(body).not.toContainText('尚未保存的段落');
  await page.getByRole('button', { name: '打开资料库', exact: true }).click();
  const card = page.locator('.asset-card[data-asset-path="角色/林晚.md"]');
  await expect(card).toBeVisible();
  const alignment = await card.evaluate(element => {
    const style = getComputedStyle(element);
    const bounds = element.getBoundingClientRect();
    const left = bounds.left + parseFloat(style.paddingLeft) + parseFloat(style.borderLeftWidth);
    const top = bounds.top + parseFloat(style.paddingTop) + parseFloat(style.borderTopWidth);
    const children = [...element.children].map(child => child.getBoundingClientRect());
    return {
      text: style.textAlign,
      leftOffsets: children.map(child => Math.abs(child.left - left)),
      topOffset: Math.abs(children[0]!.top - top)
    };
  });
  expect(alignment.text).toBe('left');
  expect(alignment.leftOffsets.every(offset => offset < 1)).toBe(true);
  expect(alignment.topOffset).toBeLessThan(1);
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'library-card-alignment.png') });
  const libraryTab = page.getByRole('tab', { name: '资料库', exact: true });
  await libraryTab.click({ button: 'right' });
  await expect(page.getByRole('menuitem', { name: '与 Agent 讨论此文件', exact: true })).toHaveCount(0);
  await page.getByRole('menuitem', { name: '关闭', exact: true }).click();
  await expect(libraryTab).toHaveCount(0);
  await expect(body).toContainText('开发态也应当显示的正文');
});

test('侧栏只通过活动栏收起，保留辅助栏视图与 Agent 草稿', async () => {
  await expect(page.getByRole('button', { name: '隐藏侧栏', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '隐藏辅助栏', exact: true })).toHaveCount(0);
  const draft = page.getByPlaceholder('描述你的创作需求...');
  await draft.fill('保留的讨论草稿');
  await page.getByRole('tab', { name: '参考', exact: true }).click();
  const toggle = page.getByRole('button', { name: '切换 Agent 面板', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(page.getByRole('complementary', { name: '辅助栏', exact: true })).toBeHidden();
  await toggle.click();
  await expect(page.getByRole('tab', { name: '参考', exact: true })).toHaveAttribute('aria-selected', 'true');
  await page.getByRole('tab', { name: 'Agent', exact: true }).click();
  await expect(draft).toHaveValue('保留的讨论草稿');
  for (const label of ['搜索', '资料库', '审查', '记忆', '工作区']) {
    const button = page.getByRole('button', { name: label, exact: true });
    await button.click();
    await expect(page.getByRole('complementary', { name: '工作区侧栏', exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: '隐藏侧栏', exact: true })).toHaveCount(0);
    await button.click();
    await expect(page.getByRole('complementary', { name: '工作区侧栏', exact: true })).toBeHidden();
  }
});

test('开发态内容删除按钮能打开完整预览且无组件解析警告', async () => {
  await page.evaluate(async rootPath => {
    await (window as Window & { chaptaleDesktop: ChaptaleDesktopApi }).chaptaleDesktop.content.save({
      rootPath,
      scope: 'user',
      kind: 'persona',
      id: 'temporary-planner',
      markdown: '---\nid: temporary-planner\nname: 临时策划\ntype: custom\nexecution: chat\n---\n检查故事目标。\n'
    });
  }, workspace);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '专员与内容 专员、技能、模板', exact: true }).click();
  const filter = await page.getByRole('textbox', { name: '筛选创作内容', exact: true }).boundingBox();
  const state = await page.getByRole('combobox', { name: '内容状态', exact: true }).boundingBox();
  expect(Math.abs(filter!.y + filter!.height / 2 - state!.y - state!.height / 2)).toBeLessThan(1);
  await page.getByRole('button', { name: '永久删除 临时策划', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除此内容？', exact: true });
  await expect(dialog).toContainText('temporary-planner.md');
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(page.getByRole('button', { name: '临时策划 temporary-planner', exact: true })).toHaveCount(0);
});
