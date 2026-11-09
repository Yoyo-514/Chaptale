import { _electron as electron, expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { existsSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const desktop = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktop, 'package.json'))('electron') as string;
let application: ElectronApplication | undefined;
let home: string;

test.beforeEach(async () => {
  home = await mkdtemp(path.join(tmpdir(), 'chaptale-data-dir-e2e-'));
  await mkdir(path.join(home, '.chaptale'));
});

test.afterEach(async () => {
  await application?.close();
  application = undefined;
  await rm(home, { recursive: true, force: true });
});

async function launch(): Promise<Page> {
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as Record<string, string | undefined>).VITE_DEV_SERVER_URL;
  application = await electron.launch({
    executablePath,
    args: [desktop, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  const page = await application.firstWindow();
  await page.waitForLoadState('domcontentloaded');
  return page;
}

const settingsFile = () => path.join(home, '.chaptale/settings.json');

test('首次启动先选择数据位置，确认后作品库建在所选文件夹', async () => {
  await writeFile(settingsFile(), JSON.stringify({ version: 1, workspace: {} }));
  const page = await launch();
  await expect(page.getByRole('heading', { name: '选择数据存放位置' })).toBeVisible();
  await expect(page.getByRole('textbox', { name: '数据存放位置' })).toHaveValue(path.join(home, '.chaptale', 'data'));
  await expect(page.getByRole('button', { name: '新建作品', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '开始使用', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建作品', exact: true })).toBeVisible();
  expect(JSON.parse(await readFile(settingsFile(), 'utf8'))).toMatchObject({
    dataDir: path.join(home, '.chaptale', 'data')
  });
  await expect.poll(() => existsSync(path.join(home, '.chaptale/data/library.sqlite'))).toBe(true);
});

test('记录的数据文件夹不存在时停在说明页，不新建目录；文件夹恢复后重试进入', async () => {
  const missing = path.join(home, '移动硬盘', 'Chaptale');
  await writeFile(settingsFile(), JSON.stringify({ version: 1, workspace: {}, dataDir: missing }));
  const page = await launch();
  await expect(page.getByRole('heading', { name: '找不到数据文件夹' })).toBeVisible();
  await expect(page.getByText(missing, { exact: true })).toBeVisible();
  expect(existsSync(missing)).toBe(false);
  await mkdir(missing, { recursive: true });
  await page.getByRole('button', { name: '重试', exact: true }).click();
  await expect(page.getByRole('button', { name: '新建作品', exact: true })).toBeVisible();
});
