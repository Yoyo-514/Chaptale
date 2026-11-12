import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { Workbench } from './fixtures/workbench';

let workbench: Workbench;
let page: Page;

test.beforeEach(async () => {
  workbench = await Workbench.start('attributes');
  page = workbench.page;
});

test.afterEach(async () => {
  await workbench.dispose(test.info().status !== test.info().expectedStatus);
});

test('资料类型、别名与标签随正文保存，重启后保留', async () => {
  test.setTimeout(60_000);
  await workbench.createWork('长夜行');
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page
    .getByRole('complementary', { name: '作品导航' })
    .getByRole('button', { name: '作品操作', exact: true })
    .click();
  await page.getByRole('menuitem', { name: '新建资料', exact: true }).click();
  await page.getByRole('textbox', { name: '文档标题', exact: true }).fill('林晚');
  await page.getByRole('button', { name: '创建文档', exact: true }).click();

  const panel = page.getByRole('region', { name: '资料属性', exact: true });
  await panel.getByRole('button', { name: /^属性/ }).click();
  await panel.getByRole('combobox', { name: '类型', exact: true }).fill('人物');
  const alias = panel.getByRole('textbox', { name: '添加别名', exact: true });
  await alias.fill('小林');
  await alias.press('Enter');
  await expect(panel.getByText('小林', { exact: true })).toBeVisible();
  const tag = panel.getByRole('textbox', { name: '添加标签', exact: true });
  await tag.fill('主角');
  await tag.press('Enter');
  await panel.getByRole('button', { name: '移除别名小林', exact: true }).click();
  await alias.fill('阿晚');
  await alias.press('Enter');
  await expect(page.getByRole('tab', { name: '林晚（未保存）', exact: true })).toBeVisible();
  await page.keyboard.press('Control+s');
  await expect(page.getByRole('tab', { name: '林晚', exact: true })).toBeVisible();

  await workbench.restart();
  page = workbench.page;
  await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
  await page.getByRole('treeitem', { name: '林晚' }).click();
  const reopened = page.getByRole('region', { name: '资料属性', exact: true });
  // 折叠时摘要显示类型与标签。
  await expect(reopened.getByRole('button', { name: '属性 人物，别名 阿晚，标签 主角', exact: true })).toBeVisible();
  await reopened.getByRole('button', { name: /^属性/ }).click();
  await expect(reopened.getByRole('combobox', { name: '类型', exact: true })).toHaveValue('人物');
  await expect(reopened.getByText('阿晚', { exact: true })).toBeVisible();
  await expect(reopened.getByText('主角', { exact: true })).toBeVisible();
  await expect(reopened.getByText('小林', { exact: true })).toHaveCount(0);
});

for (const decision of ['accept', 'reject'] as const) {
  test(`资料属性整组${decision === 'accept' ? '接受' : '拒绝'}，正文继续待审并在重启后保留结果`, async () => {
    test.setTimeout(90_000);
    await workbench.createWork('长夜行');
    const fixture = await page.evaluate(async () => {
      const client = window.chaptaleDesktop.creation;
      const works = await client.request('listWorks', {});
      if (!works.ok) throw new Error(works.error.message);
      const workId = works.value[0]!.id;
      const created = await client.request('createEntry', {
        commandId: crypto.randomUUID(),
        workId,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '沈霁',
        format: 'txt',
        content: '守城的将军。'
      });
      if (!created.ok) throw new Error(created.error.message);
      const saved = await client.request('saveDocument', {
        commandId: crypto.randomUUID(),
        workId,
        documentId: created.value.id,
        expectedRevisionId: created.value.revisionId,
        title: '沈霁',
        format: 'txt',
        content: '守城的将军。',
        attributes: { type: '人物', aliases: ['阿霁'], tags: ['主角'], cover: null }
      });
      if (!saved.ok) throw new Error(saved.error.message);
      await window.chaptaleDesktop.agentHost.request('saveProvider', {
        id: 'electron-attributes',
        apiKey: 'offline-test-only',
        config: {
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          models: [{ id: 'offline', name: '离线属性测试', contextWindow: 8192, maxTokens: 128 }]
        }
      });
      return { workId, documentId: created.value.id };
    });
    await workbench.application.close();
    // 用真实 SDK 建立有指令的用户历史，再由公共应用入口生成候选；全程不请求模型。
    const { stdout } = await promisify(execFile)(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        `
        import { SessionManager } from '@earendil-works/pi-coding-agent';
        import { builtinWritingInstructions } from '@chaptale/agent-host';
        import { CreationApplication } from '@chaptale/creation/application';
        import { openCreationStorage } from '@chaptale/storage';
        import path from 'node:path';
        const [rootDir, workId, documentId] = process.argv.slice(1);
        const manager = SessionManager.create(
          path.join(rootDir, 'works', workId, 'files'), path.join(rootDir, 'sessions', workId)
        );
        manager.appendModelChange('electron-attributes', 'offline');
        manager.appendCustomEntry('chaptale-agent-instructions', { entries: builtinWritingInstructions });
        manager.appendCustomEntry('chaptale-edit-mode', { mode: 'review' });
        manager.appendMessage({ role: 'user', content: '完善沈霁的资料。', timestamp: Date.now() });
        const app = new CreationApplication(await openCreationStorage({ rootDir }));
        try {
          const current = app.executeAuthor({ method: 'readDocument', input: { workId, documentId } });
          if (!current.ok) throw new Error(current.error.message);
          const result = app.executeAgent({ sessionId: manager.getSessionId(), mode: 'review' }, {
            method: 'writeContent', input: {
              commandId: crypto.randomUUID(), workId, documentId,
              expectedRevisionId: current.value.revisionId, content: '出征的将军。',
              attributes: { type: '将领', aliases: ['小沈'], tags: ['守城'] }
            }
          });
          if (!result.ok) throw new Error(result.error.message);
          console.log(JSON.stringify({ file: manager.getSessionFile() }));
        } finally { app.close(); }
        `,
        path.join(workbench.home, '.chaptale/creation'),
        fixture.workId,
        fixture.documentId
      ],
      { cwd: path.resolve('apps/desktop') }
    );
    const history = JSON.parse(stdout.trim()) as { file: string };
    await workbench.launch();
    page = workbench.page;
    await page.evaluate(file => window.chaptaleDesktop.agentHost.request('open', { file }), history.file);
    await page.getByRole('tablist', { name: '内容区域' }).getByRole('tab', { name: '资料', exact: true }).click();
    await page.getByRole('treeitem', { name: /沈霁/ }).click();
    await page.getByRole('button', { name: '查看修改', exact: true }).click();
    const review = page.getByRole('region', { name: '审阅《沈霁》', exact: true });
    const attributes = review.getByRole('region', { name: '资料属性修改', exact: true });
    await expect(attributes).toContainText('阿霁');
    await expect(attributes).toContainText('小沈');
    await expect(attributes.getByRole('textbox')).toHaveCount(0);
    await attributes
      .getByRole('button', { name: decision === 'accept' ? '接受属性' : '保留原属性', exact: true })
      .click();
    const expected =
      decision === 'accept'
        ? { type: '将领', aliases: ['小沈'], tags: ['守城'], cover: null }
        : { type: '人物', aliases: ['阿霁'], tags: ['主角'], cover: null };
    const read = () =>
      page.evaluate(async input => {
        const result = await window.chaptaleDesktop.creation.request('readDocument', input);
        if (!result.ok) throw new Error(result.error.message);
        return result.value;
      }, fixture);
    await expect.poll(read).toMatchObject({ content: '守城的将军。', attributes: expected });
    await expect(review).toContainText('出征的将军。');
    await review.getByRole('button', { name: '全部接受', exact: true }).click();
    await expect.poll(read).toMatchObject({ content: '出征的将军。', attributes: expected });
    await workbench.restart();
    page = workbench.page;
    await expect.poll(read).toMatchObject({ content: '出征的将军。', attributes: expected });
  });
}
