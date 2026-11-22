import { _electron as electron, expect, test } from '@playwright/test';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';

test('查找替换按大小写和正则匹配，替换后可撤销', async () => {
  const home = await mkdtemp(path.join(tmpdir(), 'chaptale-search-'));
  const desktop = path.resolve('apps/desktop');
  await mkdir(path.join(home, '.chaptale/creation'), { recursive: true });
  await writeFile(
    path.join(home, '.chaptale/settings.json'),
    // 预先选定数据目录，跳过首次启动的位置选择页。
    JSON.stringify({
      version: 1,
      workspace: {},
      dataDir: path.join(home, '.chaptale/creation'),
      checkUpdatesOnStartup: false
    })
  );
  const env = { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' };
  delete (env as Record<string, string | undefined>).VITE_DEV_SERVER_URL;
  delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({
    executablePath: createRequire(path.join(desktop, 'package.json'))('electron'),
    args: [desktop, `--user-data-dir=${path.join(home, 'profile')}`],
    env
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByRole('heading', { name: '作品库', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const api = (window as typeof window & { chaptaleDesktop: ChaptaleDesktopApi }).chaptaleDesktop.creation;
      const work = await api.request('createWork', {
        commandId: crypto.randomUUID(),
        title: '查找练习',
        kind: 'novel'
      });
      if (!work.ok) throw new Error(work.error.message);
      const entry = await api.request('createEntry', {
        commandId: crypto.randomUUID(),
        workId: work.value.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '第一章',
        format: 'txt',
        content: 'Alice Alice alice\n小雨 大雨'
      });
      if (!entry.ok) throw new Error(entry.error.message);
    });
    await page.getByRole('button', { name: '查找练习', exact: true }).click();
    await page.getByRole('treeitem', { name: '第一章', exact: true }).click();
    const body = page.getByRole('textbox', { name: '文档正文', exact: true });
    await body.click();
    await page.keyboard.press('Control+f');
    const search = page.getByRole('textbox', { name: '查找', exact: true });
    const replace = page.getByRole('textbox', { name: '替换', exact: true });
    await expect(search).toBeFocused();
    await expect(replace).toBeHidden();
    await search.fill('Alice');
    await page.getByRole('button', { name: '区分大小写', exact: true }).click();
    await expect(page.getByRole('button', { name: '区分大小写', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: '展开替换', exact: true }).click();
    await replace.fill('Bob');
    await page.getByRole('button', { name: '全部替换', exact: true }).click();
    await expect(body).toHaveText('Bob Bob alice\n小雨 大雨', { useInnerText: true });
    await page.keyboard.press('Escape');
    await body.press('Control+z');
    await expect(body).toHaveText('Alice Alice alice\n小雨 大雨', { useInnerText: true });

    await body.press('Control+h');
    await expect(replace).toBeVisible();
    // 不开正则时反斜杠按字面找，不会当成换行。
    await search.fill('alice\\n小雨');
    await replace.fill('夜');
    await replace.press('Enter');
    await replace.press('Enter');
    await expect(body).toHaveText('Alice Alice alice\n小雨 大雨', { useInnerText: true });
    await search.fill('[');
    await page.getByRole('button', { name: '正则表达式', exact: true }).click();
    await expect(search).toHaveAttribute('aria-invalid', 'true');
    await expect(page.getByRole('button', { name: '全部替换', exact: true })).toBeDisabled();
    await search.fill('[小大]雨');
    await replace.fill('夜雨');
    await page.getByRole('button', { name: '全部替换', exact: true }).click();
    await expect(body).toHaveText('Alice Alice alice\n夜雨 夜雨', { useInnerText: true });
    await page.getByRole('button', { name: '关闭查找（Escape）', exact: true }).click();
    await expect(body).toBeFocused();
    await page.keyboard.press('Control+z');
    await expect(body).toHaveText('Alice Alice alice\n小雨 大雨', { useInnerText: true });
  } finally {
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach(window => window.destroy()));
    await app.close();
    await rm(home, { recursive: true, force: true });
  }
});
