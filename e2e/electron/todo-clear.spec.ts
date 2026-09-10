import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };
let home: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-todo-e2e-'));
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    JSON.stringify({ version: 1, storage: { mode: 'global' }, onboarding: { completedVersion: 1 } })
  );
  const env = { ...process.env, NODE_ENV: 'production', HOME: home, USERPROFILE: home };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  await expect(page.getByPlaceholder('描述你的创作需求...')).toBeVisible();
});

test.afterEach(async () => {
  await app.close();
  expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
  expect(path.basename(home)).toMatch(/^chaptale-todo-e2e-/);
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

test('用户可手动清空已完成与清空全部任务清单', async () => {
  // 启动时没有会话：显式创建一个并记为当前会话，reload 后 renderer 才能拉到对应 todo 清单。
  const created = await page.evaluate(() => (window as DesktopWindow).chaptaleDesktop.session.create());
  await page.evaluate(async id => {
    await (window as DesktopWindow).chaptaleDesktop.settings.update({ lastSessionId: id });
  }, created.id);
  const sessionId = created.id;
  const todosPath = path.join(home, '.chaptale/agent/todos', `${sessionId}.json`);
  await mkdir(path.dirname(todosPath), { recursive: true });
  await writeFile(
    todosPath,
    JSON.stringify([
      { id: '1', content: '已完成任务', status: 'completed' },
      { id: '2', content: '进行中任务', status: 'in_progress' },
      { id: '3', content: '待办任务', status: 'pending' }
    ]),
    'utf8'
  );

  await page.reload();
  await expect(page.getByPlaceholder('描述你的创作需求...')).toBeVisible();
  const card = page.getByRole('button', { name: /1\/3/ });
  await expect(card).toBeVisible();
  await card.click();
  await expect(page.getByText('已完成任务')).toBeVisible();
  await expect(page.getByText('待办任务')).toBeVisible();

  // 清空已完成：仅移除 completed 项。
  await page.getByRole('button', { name: '清空已完成', exact: true }).click();
  await expect(page.getByText('已完成任务')).toHaveCount(0);
  await expect(page.locator('.todo-item')).toHaveCount(2);
  expect(JSON.parse(await readFile(todosPath, 'utf8'))).toEqual([
    { id: '2', content: '进行中任务', status: 'in_progress' },
    { id: '3', content: '待办任务', status: 'pending' }
  ]);

  // 清空全部：确认弹窗后整表移除，卡片随空表隐藏。
  await page.getByRole('button', { name: '清空全部', exact: true }).click();
  const confirmDialog = page.getByRole('alertdialog');
  await expect(confirmDialog).toContainText('清空全部任务？');
  await confirmDialog.getByRole('button', { name: '清空全部', exact: true }).click();
  await expect(page.getByRole('button', { name: /任务进度/ })).toHaveCount(0);
  expect(JSON.parse(await readFile(todosPath, 'utf8'))).toEqual([]);
});
