import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
let home: string;
let app: ElectronApplication;
let page: Page;

test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-provider-e2e-'));
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
  expect(path.basename(home)).toMatch(/^chaptale-provider-e2e-/);
  await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
});

/** 打开设置面板并切到模型服务，返回“添加自定义供应商”弹窗。 */
async function openCustomProviderDialog(target: Page) {
  await target.getByRole('button', { name: '打开设置', exact: true }).click();
  await target.getByRole('button', { name: '模型 供应商、API Key 与默认模型', exact: true }).click();
  await expect(target.getByRole('heading', { name: '模型服务', exact: true })).toBeVisible();
  await target.getByRole('button', { name: '添加供应商', exact: true }).click();
  const dialog = target.getByRole('dialog', { name: '添加自定义供应商', exact: true });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('表单填写的模型未点「加入待添加列表」时随供应商一起写入 models.json 并显示', async () => {
  const dialog = await openCustomProviderDialog(page);

  await dialog.getByLabel('供应商 ID').fill('repro-provider');
  await dialog.getByLabel('显示名称').fill('Repro Provider');
  await dialog.getByLabel('API Key').fill('sk-repro');
  await dialog.getByLabel('Base URL').fill('https://repro.example.com/v1');
  // 只填写模型草稿，不点「加入待添加列表」——表单内容不能静默丢失。
  await dialog.getByLabel('模型 ID').fill('repro-model');
  await dialog.getByLabel('模型名称').fill('Repro Model');

  await dialog.getByRole('button', { name: '添加供应商', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('button', { name: /Repro Provider/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Repro Provider/ })).toContainText('1 个模型');

  const modelsJson = JSON.parse(await readFile(path.join(home, '.chaptale/agent/models.json'), 'utf8')) as {
    providers: Record<string, { models?: Array<{ id: string }> }>;
  };
  expect(modelsJson.providers['repro-provider'].models?.map(model => model.id)).toContain('repro-model');
});

test('不带模型的供应商也显示在列表，作为后续添加模型的入口', async () => {
  const dialog = await openCustomProviderDialog(page);

  await dialog.getByLabel('供应商 ID').fill('empty-provider');
  await dialog.getByLabel('显示名称').fill('Empty Provider');
  await dialog.getByLabel('Base URL').fill('https://empty.example.com/v1');

  await dialog.getByRole('button', { name: '添加供应商', exact: true }).click();
  await expect(dialog).toBeHidden();

  await expect(page.getByRole('button', { name: /Empty Provider/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Empty Provider/ })).toContainText('0 个模型');
});
