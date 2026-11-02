import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';

const desktop = path.resolve('apps/desktop');
const executablePath = createRequire(path.join(desktop, 'package.json'))('electron') as string;

/** 用独立临时用户目录启动的生产构建桌面应用，只关闭本用例启动的实例。 */
export class Workbench {
  application!: ElectronApplication;
  page!: Page;

  private constructor(readonly home: string) {}

  static async start(prefix: string): Promise<Workbench> {
    const home = await mkdtemp(path.join(tmpdir(), `chaptale-${prefix}-`));
    await mkdir(path.join(home, '.chaptale'));
    await writeFile(path.join(home, '.chaptale/settings.json'), JSON.stringify({ version: 1, workspace: {} }));
    const workbench = new Workbench(home);
    await workbench.launch();
    return workbench;
  }

  async launch() {
    const env = { ...process.env, HOME: this.home, USERPROFILE: this.home, NODE_ENV: 'production' };
    delete (env as Record<string, string | undefined>).VITE_DEV_SERVER_URL;
    delete (env as Record<string, string | undefined>).ELECTRON_RUN_AS_NODE;
    this.application = await electron.launch({
      executablePath,
      args: [desktop, `--user-data-dir=${path.join(this.home, 'profile')}`],
      env
    });
    this.page = await this.application.firstWindow();
    await this.page.waitForLoadState('domcontentloaded');
  }

  async restart() {
    await this.application.close();
    await this.launch();
  }

  /** destroyWindows 跳过退出确认框，用于结束时仍有未保存输入的用例。 */
  async dispose(destroyWindows: boolean) {
    if (destroyWindows && this.application?.process().exitCode === null)
      await this.application.evaluate(({ BrowserWindow }) => {
        for (const window of BrowserWindow.getAllWindows()) window.destroy();
      });
    await this.application?.close();
    await rm(this.home, { recursive: true, force: true });
  }

  /** 资料页的关系与事件默认折叠。 */
  async expandStory() {
    await this.page
      .getByRole('region', { name: '关系与事件', exact: true })
      .getByRole('button', { name: /^关系与事件/ })
      .click();
  }

  async createWork(title: string) {
    await this.page.getByRole('button', { name: '新建作品', exact: true }).click();
    await this.page.getByRole('textbox', { name: '作品名称', exact: true }).fill(title);
    await this.page.getByRole('button', { name: '创建作品', exact: true }).click();
  }

  async createDocument(title: string, text: string, save = true) {
    const page = this.page;
    await page
      .getByRole('complementary', { name: '作品导航' })
      .getByRole('button', { name: '作品操作', exact: true })
      .click();
    await page.getByRole('menuitem', { name: '新建文稿', exact: true }).click();
    await page.getByRole('textbox', { name: '文档标题', exact: true }).fill(title);
    await page.getByRole('button', { name: '创建文档', exact: true }).click();
    const body = page.getByRole('textbox', { name: '文档正文', exact: true });
    await body.click();
    await page.keyboard.insertText(text);
    if (save) {
      await body.press('Control+s');
      await expect(page.getByRole('tab', { name: title, exact: true })).toBeVisible();
    }
  }
}
