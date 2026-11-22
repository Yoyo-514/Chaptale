import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';

import { Workbench } from './fixtures/workbench';

type MainHelpTestState = { openedPath?: string; openedUrl?: string };
type RendererHelpTestState = { copiedVersion?: string };

function helpTrigger(page: Page) {
  return page.getByRole('menubar').getByRole('menuitem', { name: '帮助', exact: true });
}

test('从顶栏查看快捷键和关于；键盘关闭弹窗后回到帮助菜单', async () => {
  const workbench = await Workbench.start('help-e2e');
  const { application, home, page } = workbench;
  try {
    const regularViewport = { width: 1200, height: 720 };
    await page.setViewportSize(regularViewport);
    const trigger = helpTrigger(page);
    await trigger.press('Enter');
    await page.getByRole('menuitem', { name: '快捷键一览…', exact: true }).press('Enter');
    const shortcuts = page.getByRole('dialog', { name: '快捷键一览' });
    await expect(shortcuts.getByText('退出专注模式', { exact: true })).toBeVisible();
    await expect(shortcuts.getByText(/^(Ctrl|Cmd)\+Shift\+F$/)).toBeVisible();
    const lastShortcut = shortcuts.getByText('全作品替换', { exact: true });
    const scrollbar = shortcuts.locator('[data-slot="app-scroll-area-scrollbar"]');
    await expect(lastShortcut).toBeInViewport();
    await expect(scrollbar).toHaveCount(0);

    await page.setViewportSize({ ...regularViewport, height: 380 });
    await expect(scrollbar).toBeVisible();
    await shortcuts.locator('[data-slot="app-scroll-area-viewport"]').evaluate(viewport => {
      viewport.scrollTop = viewport.scrollHeight;
    });
    await expect(lastShortcut).toBeInViewport();
    await page.setViewportSize(regularViewport);

    await page.keyboard.press('Escape');
    await expect(shortcuts).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await trigger.click();
    await page.getByRole('menuitem', { name: '关于…', exact: true }).click();
    const about = page.getByRole('dialog', { name: '关于 Chaptale' });
    const version = await application.evaluate(({ app }) => app.getVersion());
    await expect(about.getByText(`版本 ${version}`, { exact: true })).toBeVisible();
    // 只记录界面复制的内容，测试不覆盖作者的系统剪贴板。
    await page.evaluate(() => {
      Object.defineProperty(navigator, 'clipboard', {
        value: {
          writeText: async (text: string) => {
            (window as RendererHelpTestState).copiedVersion = text;
          }
        }
      });
    });
    await about.getByRole('button', { name: '复制版本信息' }).click();
    await expect(about.getByText('已复制到剪贴板')).toBeVisible();
    expect(await page.evaluate(() => (window as RendererHelpTestState).copiedVersion)).toContain(`Chaptale ${version}`);
    const checkOnStartup = about.getByRole('switch', { name: '启动时检查更新' });
    await expect(checkOnStartup).not.toBeChecked();
    await checkOnStartup.click();
    await expect(checkOnStartup).toBeChecked();
    await expect
      .poll(() =>
        page.evaluate(async () => (await window.chaptaleDesktop.settings.getState()).settings.checkUpdatesOnStartup)
      )
      .toBe(true);
    await page.keyboard.press('Escape');
    await expect(about).toHaveCount(0);
    await expect(trigger).toBeFocused();

    await application.evaluate(({ shell }) => {
      shell.openPath = async target => {
        (globalThis as MainHelpTestState).openedPath = target;
        return '';
      };
      shell.openExternal = async url => {
        (globalThis as MainHelpTestState).openedUrl = url;
      };
    });
    await trigger.click();
    await page.getByRole('menuitem', { name: '打开数据目录', exact: true }).click();
    await expect
      .poll(() => application.evaluate(() => (globalThis as MainHelpTestState).openedPath))
      .toBe(path.join(home, '.chaptale', 'creation'));

    await trigger.click();
    await page.getByRole('menuitem', { name: '反馈问题…', exact: true }).click();
    const openedUrl = () => application.evaluate(() => (globalThis as MainHelpTestState).openedUrl);
    await expect.poll(openedUrl).toBeDefined();
    const issueUrl = new URL((await openedUrl())!);
    expect(`${issueUrl.origin}${issueUrl.pathname}`).toBe('https://github.com/Yoyo-514/Chaptale/issues/new');
    expect(issueUrl.searchParams.get('body')).toContain(`Chaptale ${version}`);
    expect(issueUrl.searchParams.get('body')).not.toContain(home);
  } finally {
    await workbench.dispose(false);
  }
});

test('手动检查发现新版，从通知或状态栏都可查看说明并打开下载页', async () => {
  const workbench = await Workbench.start('update-e2e');
  const { application, page } = workbench;
  const server = createServer((_, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ tag_name: 'v99.0.0', body: '## 写作体验\n\n- 增加快捷键一览。' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const local = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    await application.evaluate(({ net, shell }, url) => {
      const fetch = net.fetch.bind(net);
      net.fetch = (input, init) => {
        if (input !== 'https://api.github.com/repos/Yoyo-514/Chaptale/releases/latest')
          throw new Error('更新请求地址不正确');
        return fetch(url, init);
      };
      shell.openExternal = async externalUrl => {
        (globalThis as MainHelpTestState).openedUrl = externalUrl;
      };
    }, local);

    await helpTrigger(page).click();
    await page.getByRole('menuitem', { name: '检查更新', exact: true }).click();
    const updateStatus = page.getByRole('button', { name: '有新版本，查看更新说明' });
    await expect(updateStatus).toBeVisible();
    await page.getByRole('button', { name: '打开通知中心' }).click();
    const notificationCenter = page.getByRole('region', { name: '通知中心' });
    await notificationCenter.getByRole('button', { name: '查看更新', exact: true }).click();
    const details = page.getByRole('dialog', { name: '发现新版本 99.0.0' });
    await expect(details.getByRole('heading', { name: '写作体验' })).toBeVisible();
    await expect(details.getByText('增加快捷键一览。', { exact: true })).toBeVisible();
    await details.getByRole('button', { name: '关闭' }).click();
    await expect(details).toHaveCount(0);

    await updateStatus.click();
    await details.getByRole('button', { name: '前往下载' }).click();
    await expect
      .poll(() => application.evaluate(() => (globalThis as MainHelpTestState).openedUrl))
      .toBe('https://github.com/Yoyo-514/Chaptale/releases/tag/v99.0.0');
  } finally {
    await workbench.dispose(false);
    await new Promise<void>((resolve, reject) => server.close(error => (error ? reject(error) : resolve())));
  }
});
