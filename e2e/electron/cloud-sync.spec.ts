import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;

let home: string;
let workspace: string;
let credentialFile: string;
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

async function openCloudSync() {
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '云端备份', exact: true }).click();
  await expect(page.getByRole('heading', { name: '云端备份', exact: true, level: 3 })).toBeVisible();

  return page.locator('section[aria-labelledby="cloud-accounts-title"]');
}

/**
 * 预置账户与绑定。
 *
 * 账户只能走明文降级格式：生产路径由 safeStorage 加密，密文绑定本机密钥环，测试里造不出可解开的密文；
 * 读取侧对两种格式一视同仁，所以这里仍然走真实的读取链路。绑定本来就是明文。
 */
async function seedCloudFile(input: { displayName?: string; bind?: boolean } = {}) {
  await mkdir(path.dirname(credentialFile), { recursive: true });
  await writeFile(
    credentialFile,
    JSON.stringify({
      version: 1,
      accounts: input.displayName
        ? [
            {
              provider: 'dropbox',
              displayName: input.displayName,
              connectedAt: '2026-09-13T00:00:00.000Z',
              sealed: {
                encryption: 'plaintext',
                payload: Buffer.from(JSON.stringify({ refreshToken: 'seeded' }), 'utf8').toString('base64')
              }
            }
          ]
        : [],
      bindings: input.bind
        ? {
            [workspace]: {
              provider: 'dropbox',
              folderId: '',
              folderName: '应用文件夹',
              boundAt: '2026-09-13T00:00:00.000Z'
            }
          }
        : {}
    })
  );
}

test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-cloud-e2e-'));
  workspace = path.join(home, 'novel');
  credentialFile = path.join(home, '.chaptale', 'agent', 'cloud-sync.json');
  await mkdir(path.join(home, '.chaptale'));
  await mkdir(workspace);
  // 真实作品目录里有 chaptale.json：云端绑定靠它的 id 核对身份。
  await writeFile(
    path.join(workspace, 'chaptale.json'),
    JSON.stringify({ version: 1, id: 'w-e2e', title: '夜航', kind: 'novel' })
  );
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    JSON.stringify({ version: 1, workspace: { path: workspace }, onboarding: { completedVersion: 1 } })
  );
  errors = [];
});

test.afterEach(async () => {
  try {
    if (app && test.info().status !== test.info().expectedStatus && !page.isClosed()) {
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 });
    }
    await app?.close();
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home)).toMatch(/^chaptale-cloud-e2e-/);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
});

test('两个服务商都能登录，各自的可见范围写在行里', async () => {
  await launch();
  const accounts = await openCloudSync();

  const dropbox = accounts.locator('li').filter({ hasText: 'Dropbox' });
  await expect(dropbox).toContainText('未登录');
  await expect(dropbox.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(dropbox).toContainText('/Apps/Chaptale/');

  // 应用专属文件夹：作者在云端看到的是一个只属于本应用的文件夹，其余文件它看不到。
  const oneDrive = accounts.locator('li').filter({ hasText: 'OneDrive' });
  await expect(oneDrive).toContainText('未登录');
  await expect(oneDrive.getByRole('button', { name: '登录', exact: true })).toBeVisible();
  await expect(oneDrive).toContainText('应用专属文件夹');
});

test('左下角一个入口同时显示本机与云端状态，点开就是文件与同步面板', async () => {
  await launch();

  const entry = page.getByRole('button', { name: '文件与同步', exact: true });

  await expect(entry).toContainText('本地已保存');
  await expect(entry).toContainText('云端未登录');

  await entry.click();

  const dialog = page.getByRole('dialog', { name: '文件与同步', exact: true });

  await expect(dialog).toContainText('云端备份');
  await expect(dialog).toContainText('还没有绑定云端备份位置，无法手动备份');
  await expect(dialog.getByRole('button', { name: '立即备份', exact: true })).toHaveCount(0);
});

test('已绑定时状态栏直接显示云端已绑定', async () => {
  await seedCloudFile({ displayName: 'writer@example.com', bind: true });
  await launch();

  const entry = page.getByRole('button', { name: '文件与同步', exact: true });

  await expect(entry).toContainText('云端已绑定');
  await expect(entry).not.toContainText('云端未登录');
});

test('未绑定时备份区给出绑定引导，不编造归档或配额', async () => {
  await launch();
  const accounts = await openCloudSync();
  const backup = page.locator('section[aria-labelledby="cloud-backup-title"]');

  await expect(backup).toContainText('还没有绑定云端备份位置');
  await expect(backup).toContainText('解除绑定不会删除云端归档');
  await expect(backup.getByRole('button', { name: '立即备份', exact: true })).toHaveCount(0);
  await expect(backup.locator('.cloud-file')).toHaveCount(0);
  const loginButtons = accounts.getByRole('button', { name: '登录', exact: true });
  await expect(loginButtons).toHaveCount(2);
  for (const button of await loginButtons.all()) await expect(button).toBeVisible();
});

test('已登录账户显示展示名，退出登录后凭据文件被真实清空', async () => {
  await seedCloudFile({ displayName: 'writer@example.com' });
  await launch();
  const accounts = await openCloudSync();

  const dropbox = accounts.locator('li').filter({ hasText: 'Dropbox' });
  await expect(dropbox).toContainText('writer@example.com');
  await expect(dropbox.getByRole('button', { name: '登录', exact: true })).toHaveCount(0);

  await dropbox.getByRole('button', { name: '退出登录', exact: true }).click();

  await expect(dropbox).toContainText('未登录');
  await expect(dropbox.getByRole('button', { name: '登录', exact: true })).toBeVisible();

  const stored = JSON.parse(await readFile(credentialFile, 'utf8')) as { accounts: unknown[] };
  expect(stored.accounts).toEqual([]);
});
