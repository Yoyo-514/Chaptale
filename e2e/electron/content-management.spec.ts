import { _electron as electron, expect, test } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import type { ContentKind } from '@chaptale/shared';

const desktopDir = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktopDir, 'package.json'))('electron') as string;
const visualDir = path.resolve('temp/visual-qa', `content-management-${Date.now()}`);
type DesktopWindow = Window & { chaptaleDesktop: ChaptaleDesktopApi };
let home: string;
let work: string;
let app: ElectronApplication;
let page: Page;
let errors: string[];
const definitions = [
  {
    kind: 'persona' as const,
    label: '专员',
    tab: '专员',
    id: 'custom-planner',
    name: '自定义策划',
    sourcePath: 'personas/custom-planner.md',
    markdown: '---\nid: custom-planner\nname: 自定义策划\ntype: custom\nexecution: chat\n---\n保留叙事留白。\n'
  },
  {
    kind: 'skill' as const,
    label: '技能',
    tab: '技能',
    id: 'custom-skill',
    name: '场景检查',
    sourcePath: 'skills/custom-skill/SKILL.md',
    markdown: '---\nname: custom-skill\ndescription: 场景检查\nappliesTo: []\n---\n留意人物选择。\n'
  },
  {
    kind: 'template' as const,
    label: '模板',
    tab: '模板',
    id: 'custom-template',
    name: '自定义资料',
    sourcePath: 'templates/custom-template.md',
    markdown:
      '---\ntemplate: custom-template\nname: 自定义资料\ntargetKind: note\ntargetRole: inspiration\nfields:\n  - key: title\n    label: 标题\n    type: text\n---\n# {{title}}\n'
  }
];

test.beforeEach(async () => {
  home = await mkdtemp(path.join(os.tmpdir(), 'chaptale-content-e2e-'));
  work = path.join(home, 'work');
  await mkdir(work);
  await mkdir(path.join(home, '.chaptale'));
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    JSON.stringify({
      version: 1,
      storage: { mode: 'workspace', workspacePath: work },
      onboarding: { completedVersion: 1 }
    })
  );
  errors = [];
  const env = { ...process.env, NODE_ENV: 'production', HOME: home, USERPROFILE: home };
  delete (env as NodeJS.ProcessEnv).VITE_DEV_SERVER_URL;
  app = await electron.launch({
    executablePath,
    args: [desktopDir, `--user-data-dir=${path.join(home, 'user-data')}`],
    env
  });
  page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  page.on('console', message => {
    if (message.type() === 'error' || (message.type() === 'warning' && message.text().includes('[Vue warn]')))
      errors.push(message.text());
  });
  await page.getByRole('button', { name: '打开设置', exact: true }).click();
  await page.getByRole('button', { name: '专员与内容 专员、技能、模板', exact: true }).click();
  await expect(page.getByRole('heading', { name: '专员与创作内容' })).toBeVisible();
});
test.afterEach(async () => {
  try {
    if (test.info().status !== test.info().expectedStatus && !page.isClosed())
      await page.screenshot({ path: test.info().outputPath('failure.png'), timeout: 5000 });
    await app.close();
  } finally {
    expect(path.dirname(path.resolve(home))).toBe(path.resolve(os.tmpdir()));
    expect(path.basename(home)).toMatch(/^chaptale-content-e2e-/);
    await rm(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  }
  expect(errors).toEqual([]);
});

async function save(contentKind: ContentKind) {
  const definition = definitions.find(item => item.kind === contentKind)!;
  await page.evaluate(
    async ({ rootPath, kind, id, markdown }) =>
      (window as DesktopWindow).chaptaleDesktop.content.save({ rootPath, scope: 'user', kind, id, markdown }),
    { rootPath: work, kind: contentKind, id: definition.id, markdown: definition.markdown }
  );
  await page.getByRole('button', { name: '刷新内容', exact: true }).click();
}
async function showState(label: '未归档' | '已归档') {
  await page.getByRole('combobox', { name: '内容状态', exact: true }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
}
async function archive(definition: (typeof definitions)[number]) {
  await page.getByRole('button', { name: `${definition.name} ${definition.id}`, exact: true }).click();
  await page
    .getByRole('dialog', { name: `编辑${definition.label}`, exact: true })
    .getByRole('button', { name: '归档', exact: true })
    .click();
  await page
    .getByRole('dialog', { name: '归档此内容？', exact: true })
    .getByRole('button', { name: '归档', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: `编辑${definition.label}`, exact: true })).toBeHidden();
}
async function remove(name: string) {
  await page.getByRole('button', { name: `永久删除 ${name}`, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除此内容？', exact: true });
  await expect(dialog).toContainText('不会进入回收站');
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog).toBeHidden();
}

for (const definition of definitions) {
  test(`${definition.label}可直接删除，也可归档、查看、恢复后永久删除`, async () => {
    await page.getByRole('tab', { name: definition.tab, exact: true }).click();
    await save(definition.kind);
    const filename = path.join(home, '.chaptale', definition.sourcePath);
    await remove(definition.name);
    await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' });
    await save(definition.kind);
    await archive(definition);
    await showState('已归档');
    await page.getByRole('button', { name: `${definition.name} ${definition.id}`, exact: true }).click();
    const viewer = page.getByRole('dialog', { name: `查看已归档${definition.label}`, exact: true });
    await expect(viewer).toContainText('已归档 · 只读');
    await expect(viewer.getByRole('button', { name: '永久删除', exact: true })).toBeVisible();
    await viewer.getByRole('button', { name: '取消', exact: true }).click();
    await page.getByRole('button', { name: `恢复 ${definition.name}`, exact: true }).click();
    const restore = page.getByRole('dialog', { name: '恢复已归档内容？', exact: true });
    await restore.getByRole('button', { name: '恢复内容', exact: true }).click();
    await expect(restore).toBeHidden();
    expect(await readFile(filename, 'utf8')).toBe(definition.markdown);
    await showState('未归档');
    await archive(definition);
    await showState('已归档');
    await remove(definition.name);
    await expect(page.getByRole('button', { name: `${definition.name} ${definition.id}`, exact: true })).toHaveCount(0);
  });
}

test('技能删除预览包含附件，确认期间变化会保留文件', async () => {
  await page.getByRole('tab', { name: '技能', exact: true }).click();
  await save('skill');
  const directory = path.join(home, '.chaptale/skills/custom-skill');
  await mkdir(path.join(directory, 'references'));
  const filename = path.join(directory, 'references/场景.md');
  await writeFile(filename, '原始参考');
  await page.getByRole('button', { name: '永久删除 场景检查', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '永久删除此内容？', exact: true });
  await expect(dialog).toContainText('custom-skill/references/场景.md');
  await expect(dialog).toContainText('2 个文件');
  await writeFile(filename, '确认期间改写');
  await dialog.getByRole('button', { name: '永久删除', exact: true }).click();
  await expect(dialog.getByRole('alert')).toContainText('删除范围已变化');
  expect(await readFile(filename, 'utf8')).toBe('确认期间改写');
  await mkdir(visualDir, { recursive: true });
  await page.screenshot({ path: path.join(visualDir, 'delete-conflict.png') });
  await dialog.locator('footer').getByRole('button', { name: '关闭', exact: true }).click();
  await remove('场景检查');
  await expect(readFile(filename)).rejects.toMatchObject({ code: 'ENOENT' });
});
