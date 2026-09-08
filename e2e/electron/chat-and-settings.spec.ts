import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { appendFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `chat-acceptance-${Date.now()}`);
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };
let home: string;
let app: ElectronApplication;
let page: Page;
let errors: string[];
async function launch() {
  const env = { ...process.env, NODE_ENV: 'production', HOME: home, USERPROFILE: home };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await expect(page.getByPlaceholder('描述你的创作需求...')).toBeVisible();
}
test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-chat-e2e-'));
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    JSON.stringify({ version: 1, storage: { mode: 'global' }, onboarding: { completedVersion: 1 } })
  );
  errors = [];
  await launch();
});
test.afterEach(async () => {
  try {
    if (test.info().status !== test.info().expectedStatus && !page.isClosed()) {
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 });
    }
    await app.close();
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home)).toMatch(/^chaptale-chat-e2e-/);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
});

test('M6 slash 设置命令打开真实面板，不发送 Agent 消息', async () => {
  const input = page.getByPlaceholder('描述你的创作需求...');
  await input.fill('/set');
  await expect(page.getByRole('option', { name: /\/settings/ })).toBeVisible();
  await input.press('Enter');
  await expect(input).toHaveValue('/settings ');
  await input.press('Enter');
  await expect(page.getByRole('heading', { name: '设置', exact: true })).toBeVisible();
  const sessions = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.session.list());
  expect(sessions.every(session => session.messageCount === 0)).toBe(true);
});

test('M6 Prompt 设置经真实文件保存、重载并恢复内置正文', async () => {
  const defaults = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.promptSettings.getState());
  expect(path.resolve(defaults.systemPromptPath).startsWith(path.resolve(home) + path.sep)).toBe(true);
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: /Prompt System 与追加提示/ }).click();
  const system = page.getByRole('textbox', { name: 'System Prompt', exact: true });
  const append = page.getByRole('textbox', { name: 'Append System Prompt', exact: true });
  await expect(system).toHaveValue(defaults.defaultSystemPrompt);
  await system.fill('尊重作者确认的叙事目标。');
  await append.fill('本次偏好：保留叙述留白。');
  await page.getByRole('button', { name: '保存 Prompt 设置', exact: true }).click();
  await expect.poll(() => readFile(defaults.systemPromptPath, 'utf8')).toBe('尊重作者确认的叙事目标。');
  expect(await readFile(defaults.appendSystemPromptPath, 'utf8')).toBe('本次偏好：保留叙述留白。');
  await page.reload();
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: /Prompt System 与追加提示/ }).click();
  await expect(system).toHaveValue('尊重作者确认的叙事目标。');
  await expect(append).toHaveValue('本次偏好：保留叙述留白。');
  await page.getByRole('button', { name: '恢复默认 System Prompt', exact: true }).click();
  await expect(system).toHaveValue(defaults.defaultSystemPrompt);
  await page.getByRole('button', { name: '保存 Prompt 设置', exact: true }).click();
  await expect.poll(() => readFile(defaults.systemPromptPath, 'utf8')).toBe(defaults.defaultSystemPrompt);
});

test('M6 联网开关落盘并在重载和设置中保持一致', async () => {
  const toggle = page.getByRole('button', { name: '关闭联网搜索', exact: true });
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');
  await toggle.click();
  await expect(page.getByRole('button', { name: '开启联网搜索', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await expect
    .poll(
      async () => JSON.parse(await readFile(path.join(home, '.chaptale/agent/web-tools.json'), 'utf8')).search.enabled
    )
    .toBe(false);
  await page.reload();
  await expect(page.getByRole('button', { name: '开启联网搜索', exact: true })).toHaveAttribute(
    'aria-pressed',
    'false'
  );
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '联网 搜索、提取与 API Key', exact: true }).click();
  await expect(page.getByRole('heading', { name: '联网与内容提取', exact: true })).toBeVisible();
});

test('M6 无模型回复明确失败，已交付输入仍可回放和编辑', async () => {
  const input = page.getByPlaceholder('描述你的创作需求...');
  await input.fill('请保留这份未发送草稿。');
  await page.locator('.chat-send-button').click();
  await expect(page.locator('.notification-center')).toContainText('未配置默认模型');
  await expect(page.locator('.user-message')).toHaveText('请保留这份未发送草稿。');
  await expect(page.locator('.assistant-streaming-indicator')).toHaveCount(0);
  const sessions = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.session.list());
  expect(sessions.reduce((sum, session) => sum + session.messageCount, 0)).toBe(1);
  await page.reload();
  await expect(page.locator('.user-message')).toHaveText('请保留这份未发送草稿。');
  await page.locator('.user-message').hover();
  await page.getByRole('button', { name: '编辑并重试', exact: true }).click();
  await expect(page.locator('.user-message-editor')).toHaveValue('请保留这份未发送草稿。');
  await page.getByRole('button', { name: '取消', exact: true }).click();
});

test('M6 会话目录写入失败会退还未交付草稿，且不残留虚假消息', async () => {
  const state = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.settings.getState());
  const directory = path.resolve(state.paths.effectiveSessionDir);
  expect(directory.startsWith(path.resolve(home) + path.sep)).toBe(true);
  await rename(directory, `${directory}.previous`);
  await writeFile(directory, 'session storage unavailable');

  const input = page.getByPlaceholder('描述你的创作需求...');
  await input.fill('这份未交付原稿必须保留。');
  await page.locator('.chat-send-button').click();
  await expect(page.locator('.notification-center')).toContainText('发送失败');
  await expect(input).toHaveValue('这份未交付原稿必须保留。');
  await expect(page.locator('.user-message')).toHaveCount(0);
  await expect(page.locator('.assistant-streaming-indicator')).toHaveCount(0);
});

test('M6 通知中心已读后只自动展示新错误，不调用模型', async () => {
  const input = page.getByPlaceholder('描述你的创作需求...');
  await input.fill('/unknown-command-one');
  await page.locator('.chat-send-button').click();
  const center = page.locator('.notification-center');
  await expect(center).toContainText('未知命令：/unknown-command-one');
  await page.getByRole('button', { name: '打开通知中心', exact: true }).click();
  await expect(center).toHaveClass(/is-manual/);
  await expect(page.locator('.notification-count')).toHaveCount(0);
  await page.getByRole('button', { name: '打开通知中心', exact: true }).click();
  await expect(center).toBeHidden();
  await input.fill('/unknown-command-two');
  await page.locator('.chat-send-button').click();
  await expect(center).toContainText('未知命令：/unknown-command-two');
  await expect(center).not.toContainText('unknown-command-one');
  await expect(page.locator('.notification-count')).toHaveText('1');
});

test('M6 落盘技能与图片经真实消息投影回放，原图可预览', async () => {
  const png = await app.evaluate(({ nativeImage }) =>
    nativeImage
      .createFromBitmap(Buffer.from([230, 50, 90, 255, 50, 190, 170, 255, 250, 190, 60, 255, 100, 90, 180, 255]), {
        width: 2,
        height: 2
      })
      .toPNG()
      .toString('base64')
  );
  const session = await page.evaluate(async () => {
    const api = (window as DesktopWindow).chaptaleDesktop;
    const created = await api.session.create({ name: '附件回放' });
    await api.settings.update({ lastSessionId: created.id });
    return created;
  });
  expect(path.resolve(session.path).startsWith(path.resolve(home) + path.sep)).toBe(true);
  await app.close();
  await appendFile(
    session.path,
    JSON.stringify({
      type: 'message',
      id: 'stored-illustrations',
      parentId: null,
      timestamp: new Date().toISOString(),
      message: {
        role: 'user',
        content: [
          { type: 'text', text: '/skill:blueprint-interview 图像参考。' },
          ...Array.from({ length: 3 }, () => ({ type: 'image', mimeType: 'image/png', data: png }))
        ]
      }
    }) + '\n'
  );
  await launch();
  await expect(page.locator('.user-message-skill')).toHaveText('blueprint-interview');
  await expect(page.locator('.user-message')).toContainText('图像参考。');
  await expect(page.locator('.app-image-gallery-item')).toHaveCount(3);
  const preview = page.getByRole('button', { name: '预览 用户上传的图片 1', exact: true });
  const bounds = await preview.boundingBox();
  const searchBounds = await page.getByRole('button', { name: '搜索会话内容', exact: true }).boundingBox();
  expect(bounds?.width).toBeGreaterThanOrEqual(48);
  expect(bounds?.height).toBeGreaterThanOrEqual(48);
  expect(bounds!.y).toBeGreaterThanOrEqual(searchBounds!.y + searchBounds!.height);
  await expect
    .poll(() =>
      page
        .locator('.app-image-gallery-image')
        .evaluateAll(images =>
          images.every(image => (image as HTMLImageElement).complete && (image as HTMLImageElement).naturalWidth > 0)
        )
    )
    .toBe(true);
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'message-media.png') });
  await preview.click();
  await expect(page.getByText('1 / 3', { exact: true })).toBeVisible();
  await page.screenshot({ path: path.join(visualDir, 'image-preview.png') });
});
