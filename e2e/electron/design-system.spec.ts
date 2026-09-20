import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Locator, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `design-review-${Date.now()}`);
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };
let app: ElectronApplication;
let page: Page;
let home: string;
let workspace: string;
let errors: string[];

test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-design-e2e-'));
  workspace = path.join(home, '远山来信');
  errors = [];
  await mkdir(path.join(workspace, '正文'), { recursive: true });
  await mkdir(path.join(workspace, '.chaptale/memory/notes'), { recursive: true });
  await mkdir(path.join(workspace, '角色'), { recursive: true });
  await mkdir(path.join(home, '.chaptale'));
  await mkdir(visualDir, { recursive: true });
  await writeFile(
    path.join(workspace, '正文/第一章.md'),
    '---\nkind: chapter\ntitle: 雨停之前\n---\n# 雨停之前\n\n窗外的雨还没有停。林晚把来信摊在桌上，等纸页慢慢舒展开。\n\n她决定天亮后去一趟旧车站。\n'
  );
  await writeFile(
    path.join(workspace, '角色/林晚.md'),
    '---\nid: linwan\nkind: character\ntitle: 林晚\n---\n收到一封来自旧车站的信。[[雨停之前]]\n'
  );
  await writeFile(
    path.join(workspace, '.chaptale/memory/notes/观察.md'),
    '---\nkind: note\ntitle: 关于林晚与旧车站来信的观察笔记\n---\n林晚没有立即打开来信，她在等待纸页上的雨水干透。\n'
  );
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    JSON.stringify({ version: 1, theme: 'dark', workspace: { path: workspace }, onboarding: { completedVersion: 1 } })
  );
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByRole('tree', { name: '作品文件树' })).toBeVisible();
});

test.afterEach(async () => {
  try {
    if (test.info().status !== test.info().expectedStatus && page && !page.isClosed()) {
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 });
    }
    await app?.close();
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home)).toMatch(/^chaptale-design-e2e-/);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
});

async function resize(width: number, height: number) {
  await app.evaluate(
    ({ BrowserWindow }, size) => {
      const window = BrowserWindow.getAllWindows()[0]!;
      window.setMinimumSize(320, 320);
      window.setContentSize(size.width, size.height);
    },
    { width, height }
  );
}

async function openChapter() {
  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.locator('[data-tree-path="正文/第一章.md"]').click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toContainText('林晚');
}

async function assertFieldsFit(surface: Locator) {
  const bounds = await surface.boundingBox();
  expect(bounds).not.toBeNull();
  const fields = await surface
    .locator('input:not([type="hidden"]), textarea, [role="combobox"]')
    .evaluateAll(elements =>
      elements
        .filter(element => element.getClientRects().length)
        .map(element => {
          const box = element.getBoundingClientRect();
          return { name: element.getAttribute('aria-label'), left: box.left, right: box.right };
        })
    );
  for (const field of fields) {
    expect(field.left, field.name ?? '').toBeGreaterThanOrEqual(bounds!.x - 1);
    expect(field.right, field.name ?? '').toBeLessThanOrEqual(bounds!.x + bounds!.width + 1);
  }
}

const settingsSections = [
  ['workspace', '作品', '作品与会话存储'],
  ['llm', '模型', '模型服务'],
  ['prompt', 'Prompt', 'Prompt 自定义'],
  ['content', '专员与内容', '专员与创作内容'],
  ['web', '联网', '联网与内容提取'],
  ['permissions', '权限', '权限'],
  ['cloud', '云端备份', '云端备份'],
  ['files', '配置文件', '配置文件']
] as const;

async function captureSettings(settings: Locator, theme: string, viewport: 'compact' | 'desktop') {
  for (const [key, label, heading] of settingsSections) {
    if (viewport === 'compact') {
      await settings.getByRole('combobox', { name: '设置分类', exact: true }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
    } else {
      await settings.getByRole('button', { name: label, exact: true }).click();
    }
    await expect(settings.getByRole('heading', { name: heading, exact: true, level: 3 })).toBeVisible();
    if (key === 'content') {
      await expect(settings.getByRole('button', { name: '刷新内容', exact: true })).toBeEnabled();
      const filter = await settings.getByRole('textbox', { name: '筛选创作内容', exact: true }).boundingBox();
      expect(filter!.width).toBeGreaterThanOrEqual(120);
    }
    await assertFieldsFit(settings);
    await page.screenshot({ path: path.join(visualDir, `settings-${key}-${theme}-${viewport}.png`) });
  }
}

for (const theme of ['light', 'warm', 'dark'] as const) {
  test(`${theme} 审查筛选同排显示并可用键盘清除`, async () => {
    await resize(1440, 900);
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    await page.reload();
    await page
      .getByRole('navigation', { name: '创作视图', exact: true })
      .getByRole('button', { name: '审查', exact: true })
      .click();
    const panel = page.getByRole('region', { name: '审查中心', exact: true });
    const trigger = panel.getByRole('button', { name: '审查筛选', exact: true });
    const chapter = await panel.getByRole('combobox', { name: '审查章节' }).boundingBox();
    const filter = await trigger.boundingBox();
    expect(Math.abs(chapter!.y - filter!.y)).toBeLessThanOrEqual(1);
    await trigger.focus();
    await page.keyboard.press('Enter');
    const popover = page.getByRole('dialog', { name: '审查筛选', exact: true });
    await expect(popover).toBeVisible();
    await popover.getByRole('combobox', { name: '审查运行状态' }).click();
    await page.getByRole('option', { name: '失败', exact: true }).click();
    await expect(trigger).toContainText('1');
    await expect(panel).toContainText('没有符合筛选的审查');
    await page.screenshot({ path: path.join(visualDir, `review-filters-${theme}.png`) });
    await popover.getByRole('button', { name: '清除全部筛选' }).click();
    await expect(trigger).not.toContainText('1');
    await expect(panel).toContainText('还没有审查记录');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test(`${theme} 主题在桌面与窄窗口保留可读表单和键盘焦点`, async () => {
    test.setTimeout(120_000);
    await resize(1440, 900);
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    await page.reload();
    await openChapter();
    await expect(page.locator('body')).toHaveCSS(
      'background-color',
      theme === 'dark' ? 'rgb(40, 44, 52)' : theme === 'warm' ? 'rgb(248, 243, 231)' : 'rgb(244, 246, 248)'
    );
    const source = page.getByRole('tab', { name: '源文件', exact: true });
    await source.focus();
    await source.press('ArrowLeft');
    await expect(page.getByRole('tab', { name: '表单', exact: true })).toHaveAttribute('aria-selected', 'true');
    await source.click();
    await page.screenshot({ path: path.join(visualDir, `workbench-${theme}-desktop.png`) });

    await page.getByRole('button', { name: '打开设置', exact: true }).click();
    const settings = page.getByRole('dialog', { name: '设置', exact: true });
    await expect(settings).toBeVisible();
    await settings.getByRole('button', { name: '作品', exact: true }).click();
    const internalFiles = page.getByRole('checkbox', { name: /^显示内部文件/ });
    await expect(internalFiles).toBeVisible();
    expect(
      await internalFiles.evaluate(
        element =>
          element.getBoundingClientRect().bottom <= element.closest('.settings-panel')!.getBoundingClientRect().bottom
      )
    ).toBe(true);
    await settings.getByRole('button', { name: 'Prompt', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'System Prompt', exact: true })).toBeVisible();
    await page.screenshot({ path: path.join(visualDir, `settings-${theme}-desktop.png`) });
    await captureSettings(settings, theme, 'desktop');
    await settings.getByRole('button', { name: 'Prompt', exact: true }).click();
    await expect(page.getByRole('textbox', { name: 'System Prompt', exact: true })).toBeVisible();
    await resize(390, 844);
    await expect
      .poll(() => settings.evaluate(element => element.getBoundingClientRect().right <= innerWidth))
      .toBe(true);
    const fields = await settings.locator('input, select, textarea, [role="combobox"]').evaluateAll(elements =>
      elements
        .filter(element => element.getClientRects().length)
        .map(element => {
          const box = element.getBoundingClientRect();
          return { left: box.left, right: box.right, viewport: innerWidth };
        })
    );
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      expect(field.left).toBeGreaterThanOrEqual(0);
      expect(field.right).toBeLessThanOrEqual(field.viewport);
    }
    await page.screenshot({ path: path.join(visualDir, `settings-${theme}-compact.png`) });
    const category = settings.getByRole('combobox', { name: '设置分类', exact: true });
    await expect(category).toBeVisible();
    await expect(settings.getByRole('navigation', { name: '设置分类', exact: true })).toBeHidden();
    const save = settings.getByRole('button', { name: '保存 Prompt 设置', exact: true });
    expect(
      await save.evaluate(element => {
        const rect = element.getBoundingClientRect();
        const panel = element.closest('.settings-panel')!.getBoundingClientRect();
        return rect.top >= panel.top && rect.bottom <= panel.bottom;
      })
    ).toBe(true);
    expect(await save.evaluate(element => (element as HTMLButtonElement).form?.id)).toBe('prompt-settings-form');

    await captureSettings(settings, theme, 'compact');
    await page.getByRole('button', { name: '关闭设置', exact: true }).focus();
    await page.keyboard.press('Escape');
    await expect(settings).toBeHidden();
    await page.getByRole('button', { name: '返回编辑器', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toBeVisible();
    await expect(page.getByRole('complementary', { name: '辅助栏', exact: true })).toBeHidden();
    await page.screenshot({ path: path.join(visualDir, `workbench-${theme}-compact.png`) });
    await page.getByRole('button', { name: '切换 Agent 面板', exact: true }).click();
    await expect(page.getByPlaceholder('描述你的创作需求...')).toBeVisible();
    await page.getByRole('button', { name: '返回编辑器', exact: true }).click();
    await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toContainText('林晚');
  });

  test(`${theme} 非目录树侧栏在两种窗口下保留列表与操作区`, async () => {
    test.setTimeout(120_000);
    await page.evaluate(value => (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: value }), theme);
    await page.reload();
    await openChapter();
    const primary = page.getByRole('complementary', { name: '作品侧栏', exact: true });
    const auxiliary = page.getByRole('complementary', { name: '辅助栏', exact: true });

    for (const viewport of ['desktop', 'compact'] as const) {
      await resize(viewport === 'compact' ? 390 : 1440, viewport === 'compact' ? 844 : 900);
      for (const [key, label, region] of [
        ['search', '搜索', '作品全文搜索'],
        ['structure', '资料库', '资料库导航'],
        ['review', '审查', '审查中心'],
        ['memory', '记忆', '作品记忆']
      ]) {
        await page
          .getByRole('navigation', { name: '创作视图', exact: true })
          .getByRole('button', { name: label, exact: true })
          .click();
        const panel = primary.getByRole('region', { name: region, exact: true });
        await expect(panel).toBeVisible();
        if (key === 'search') {
          await panel.getByRole('textbox', { name: '搜索作品文本', exact: true }).fill('林晚');
          await expect(panel.locator('.search-match').first()).toBeVisible();
        }
        if (key === 'memory') await expect(panel.getByRole('button', { name: /关于林晚与旧车站/ })).toBeVisible();
        await assertFieldsFit(panel);
        await page.screenshot({ path: path.join(visualDir, `sidebar-${key}-${theme}-${viewport}.png`) });
      }
      if (viewport === 'compact') await page.getByRole('button', { name: '切换 Agent 面板', exact: true }).click();
      for (const [key, label, region] of [
        ['references', '参考', '本次写作参考'],
        ['candidates', '候选', '候选稿'],
        ['review', '审查', '独立审查'],
        ['settlement', '结算', '章节结算'],
        ['assets', '资产', '资产详情'],
        ['runs', '运行', '运行记录']
      ]) {
        await auxiliary.getByRole('tab', { name: label, exact: true }).click();
        const panel = auxiliary.getByRole('region', { name: region, exact: true });
        await expect(panel).toBeVisible();
        await assertFieldsFit(panel);
        await page.screenshot({ path: path.join(visualDir, `auxiliary-${key}-${theme}-${viewport}.png`) });
      }
    }
  });
}

test('200% 缩放可还原，保存与原图资源不受影响', async () => {
  await resize(1280, 860);
  await openChapter();
  const editor = page.getByRole('textbox', { name: '文档正文', exact: true });
  await editor.click();
  await page.keyboard.press('Control+End');
  await page.keyboard.type('Saved at 200 percent.');
  await page.keyboard.press('Control+s');
  await expect.poll(() => readFile(path.join(workspace, '正文/第一章.md'), 'utf8')).toContain('Saved at 200 percent.');
  for (let i = 0; i < 6; i++) await page.keyboard.press('Control+=');
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor()))
    .toBe(2);
  await expect(editor).toBeVisible();
  await page.screenshot({ path: path.join(visualDir, 'editor-200-percent.png') });
  await page.keyboard.press('Control+0');
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.webContents.getZoomFactor()))
    .toBe(1);
  // CodeMirror 的 cm-widgetBuffer 是无 src 的光标占位，不是待加载的图片资源。
  await expect(page.locator('img[src]').first()).toBeVisible();
  await expect
    .poll(() =>
      page
        .locator('img[src]')
        .evaluateAll(elements =>
          elements
            .filter(element => element.getClientRects().length && (!element.complete || element.naturalWidth === 0))
            .map(element => ({ src: element.currentSrc || element.src, complete: element.complete }))
        )
    )
    .toEqual([]);
});

test('减少动态效果时仍保留静态加载状态', async () => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--motion-duration'))
      )
    )
    .toBe(0);
});
