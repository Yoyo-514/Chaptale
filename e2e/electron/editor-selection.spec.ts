import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi, ChaptaleTheme } from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `editor-selection-${Date.now()}`);
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };

const chapter = '# 第一章\n\n雪落在窗沿，林晚收起了信。\n';
let home: string;
let workspace: string;
let app: ElectronApplication | undefined;
let page: Page;

/** 按 WCAG 2.2 的 sRGB 定义计算相对亮度，断言实际渲染值而非固定旧色号。 */
function relativeLuminance([r, g, b]: [number, number, number]) {
  const [lr, lg, lb] = [r, g, b].map(value => {
    const channel = value / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
}

function contrastRatio(foreground: [number, number, number], background: [number, number, number]) {
  const [lighter, darker] = [relativeLuminance(foreground), relativeLuminance(background)].toSorted((a, b) => b - a);
  return (lighter! + 0.05) / (darker! + 0.05);
}

function parseColor(value: string): [number, number, number] {
  const rgb = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];
  const hex = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (hex) {
    const int = Number.parseInt(hex[1]!, 16);
    return [(int >> 16) & 255, (int >> 8) & 255, int & 255];
  }
  throw new Error(`无法解析颜色：${value}`);
}

async function launch() {
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
}

test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-selection-e2e-'));
  workspace = path.join(home, '青岚');
  await mkdir(path.join(workspace, '正文'), { recursive: true });
  await writeFile(path.join(workspace, '正文/第一章.md'), chapter);
  await launch();
  await page.evaluate(async root => {
    await (window as DesktopWindow).chaptaleDesktop.settings.update({
      workspace: { path: root },
      onboarding: { completedVersion: 1 }
    });
  }, workspace);
  await page.reload();
  await expect(page.getByRole('tree', { name: '作品文件树' })).toBeVisible();
});

test.afterEach(async () => {
  await app?.close();
  app = undefined;
  expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home)).toMatch(/^chaptale-selection-e2e-/);
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** 打开章节、聚焦编辑器并全选，返回选区自绘层与主题变量的实测值。 */
async function selectAllInEditor(theme: ChaptaleTheme) {
  await page.evaluate(async next => {
    await (window as DesktopWindow).chaptaleDesktop.settings.update({ theme: next });
  }, theme);
  await page.reload();
  await expect(page.locator('html')).toHaveClass(new RegExp(theme === 'dark' ? 'dark' : `theme-${theme}`));

  await page.getByRole('treeitem', { name: '正文', exact: true }).click();
  await page.locator('[data-tree-path="正文/第一章.md"]').click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await expect(body).toContainText('雪落在窗沿');
  await body.click();
  await page.keyboard.press('Control+a');
  await expect(page.locator('.cm-selectionBackground').first()).toBeVisible();

  return page.evaluate(() => {
    const layer = document.querySelector('.cm-selectionBackground');
    const rootStyle = getComputedStyle(document.documentElement);
    return {
      editorFocused: document.querySelector('.cm-editor')?.classList.contains('cm-focused') ?? false,
      selectionBackground: layer ? getComputedStyle(layer).backgroundColor : '',
      expectedBackground: rootStyle.getPropertyValue('--selection-background').trim(),
      selectedTextColor: rootStyle.getPropertyValue('--selection-foreground').trim()
    };
  });
}

test('深色主题聚焦选中时使用主题选区色，文字保持可读对比度', async () => {
  const measured = await selectAllInEditor('dark');

  // 聚焦态才走 CodeMirror 内置高优先级规则；不聚焦就复现不到这个缺陷。
  expect(measured.editorFocused).toBe(true);
  expect(parseColor(measured.selectionBackground)).toEqual(parseColor(measured.expectedBackground));

  const ratio = contrastRatio(parseColor(measured.selectedTextColor), parseColor(measured.selectionBackground));
  expect(ratio).toBeGreaterThanOrEqual(4.5);

  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'dark-selection.png') });
});

test('浅色与暖色主题的选区对比度同样达标', async () => {
  for (const theme of ['light', 'warm'] as const) {
    const measured = await selectAllInEditor(theme);

    expect(measured.editorFocused).toBe(true);
    expect(parseColor(measured.selectionBackground)).toEqual(parseColor(measured.expectedBackground));
    const ratio = contrastRatio(parseColor(measured.selectedTextColor), parseColor(measured.selectionBackground));
    expect(ratio, `${theme} 选区对比度`).toBeGreaterThanOrEqual(4.5);
  }
});
