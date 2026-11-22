import { expect, test, type Page } from '@playwright/test';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { Workbench } from './fixtures/workbench';

const longTitle = '长会话记录';
const shortTitle = '另一条会话';
const turns = 90;

async function menu(page: Page, group: string, item: string) {
  await page.getByRole('menubar').getByRole('menuitem', { name: group, exact: true }).click();
  await page.getByRole('menu').getByText(item, { exact: true }).click();
}

async function openHistory(page: Page, title: string) {
  await menu(page, '会话', '历史会话');
  await page.locator('.session-history-link').filter({ hasText: title }).click();
}

async function seedHistories(workbench: Workbench) {
  const workId = await workbench.page.evaluate(async () => {
    const works = await window.chaptaleDesktop.creation.request('listWorks', {});
    if (!works.ok) throw new Error(works.error.message);
    return works.value[0]!.id;
  });
  const state = await workbench.page.evaluate(async () => {
    const client = window.chaptaleDesktop.agentHost;
    await client.request('saveProvider', {
      id: 'transcript-offline',
      apiKey: 'offline-test-key',
      config: {
        baseUrl: 'http://127.0.0.1:9/v1',
        api: 'openai-completions',
        models: [{ id: 'offline', name: '离线模型', contextWindow: 100000, maxTokens: 512 }]
      }
    });
    return client.request('state', undefined);
  });
  await promisify(execFile)(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      String.raw`
      import { SessionManager } from '@earendil-works/pi-coding-agent';
      const [cwd, dir, instructions, long, short, count] = process.argv.slice(1);
      const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0, cost: {input:0,output:0,cacheRead:0,cacheWrite:0,total:0} };
      const reply = (manager, content, stopReason = 'stop') => manager.appendMessage({ role:'assistant', content, api:'openai-completions', provider:'transcript-offline', model:'offline', stopReason, usage, timestamp:Date.now() });
      for (const [title, rounds] of [[long, Number(count)], [short, 1]]) {
        const session = SessionManager.create(cwd, dir);
        session.appendSessionInfo(title);
        session.appendModelChange('transcript-offline', 'offline');
        session.appendThinkingLevelChange('off');
        session.appendCustomEntry('chaptale-agent-instructions', { entries: JSON.parse(instructions) });
        session.appendCustomEntry('chaptale-edit-mode', { mode: 'discuss' });
        for(let i=1;i<=rounds;i++) {
          session.appendMessage({role:'user',content:'作者消息 '+i,timestamp:Date.now()});
          if (i === 1 && title === long) {
            reply(session,[{ type:'text',text:'第一条带工具的回复' },{ type:'toolCall',id:'read-notes',name:'read',arguments:{path:'场景笔记.txt'} }],'toolUse');
            session.appendMessage({role:'toolResult',toolName:'read',toolCallId:'read-notes',isError:false,content:[{type:'text',text:'工具输出：旧信藏在门后'}],timestamp:Date.now()});
          } else {
            const text = {type:'text',text:'助手回复 '+i+'\n\n'+('核对场景、人物动作与对白。'.repeat(title === long ? 24 : 6))};
            reply(session, i === rounds
              ? [{type:'thinking',thinking:'依次检查人物动机和线索。'.repeat(65)}, text] : [text]);
          }
        }
      }
    `,
      workbench.home,
      path.join(workbench.home, '.chaptale', 'creation', 'sessions', workId),
      JSON.stringify(state.settings.defaultInstructions),
      longTitle,
      shortTitle,
      String(turns)
    ],
    { cwd: path.resolve('apps/desktop') }
  );
}

test('长会话按视口挂载，重开侧栏与切回会话保留阅读位置和消息状态', async () => {
  test.setTimeout(60_000);
  const workbench = await Workbench.start('agent-transcript');
  const { page } = workbench;
  page.setDefaultTimeout(10000);
  try {
    await workbench.application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1024, 768));
    await page.evaluate(() => {
      document.documentElement.dataset.transcriptResizeErrors = '0';
      window.addEventListener('error', event => {
        if (event.message.startsWith('ResizeObserver loop')) {
          const root = document.documentElement;
          root.dataset.transcriptResizeErrors = String(Number(root.dataset.transcriptResizeErrors) + 1);
        }
      });
    });
    await workbench.createWork('消息浏览');
    await expect(page.getByRole('complementary', { name: '作品导航' })).toBeVisible();
    await seedHistories(workbench);
    await openHistory(page, longTitle);
    const viewport = page.locator('.agent-message-scroll');
    const rows = viewport.locator('.agent-transcript-row');
    // 回复可能比视口还高；用末尾操作按钮和滚动距离验证贴底。
    const latestCopy = viewport
      .getByRole('article', { name: '助手', exact: true })
      .filter({ has: page.getByText(`助手回复 ${turns}`, { exact: true }) })
      .getByRole('button', { name: '复制消息', exact: true });
    const firstReply = viewport.getByText('第一条带工具的回复', { exact: true });
    await expect(latestCopy).toBeInViewport();
    await expect(firstReply).toHaveCount(0);
    expect(await rows.count()).toBeLessThan(2 * turns);
    const bottomGap = () =>
      viewport.evaluate(element => element.scrollHeight - element.clientHeight - element.scrollTop);
    await expect.poll(bottomGap).toBeLessThanOrEqual(2);

    await viewport.evaluate(element => {
      element.scrollTop = 0;
    });
    await expect(firstReply).toBeInViewport();
    const toolReply = viewport
      .getByRole('article', { name: '助手', exact: true })
      .filter({ hasText: '第一条带工具的回复' });
    await toolReply.getByRole('button', { name: '读取 1 份' }).click();
    await toolReply.locator('.agent-tool-call .agent-activity-row').click();
    const raw = toolReply.getByRole('button', { name: /原始参数与返回/ });
    await raw.click();
    await expect(raw).toHaveAttribute('aria-expanded', 'true');

    const first = viewport
      .getByRole('article', { name: '作者', exact: true })
      .filter({ has: page.getByText('作者消息 1', { exact: true }) });
    await first.hover();
    await first.getByRole('button', { name: '编辑消息' }).click();
    const edit = viewport.getByRole('textbox', { name: '编辑消息' });
    await edit.fill('未发送的修改');
    await viewport.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(latestCopy).toBeInViewport();
    await expect(firstReply).toHaveCount(0);
    await viewport.evaluate(element => {
      element.scrollTop = 36;
    });
    await expect(raw).toHaveAttribute('aria-expanded', 'true');
    await expect(edit).toHaveValue('未发送的修改');

    await menu(page, '视图', '协作栏');
    await expect(rows).toHaveCount(0);
    await menu(page, '视图', '协作栏');
    await expect(firstReply).toBeInViewport();
    await expect(edit).toHaveValue('未发送的修改');

    await viewport.evaluate(element => {
      element.scrollTop = element.scrollHeight / 2;
    });
    await expect(firstReply).toHaveCount(0);
    const readingRow = () =>
      viewport.evaluate(element => {
        const top = element.getBoundingClientRect().top;
        return [...element.querySelectorAll<HTMLElement>('.agent-transcript-row')].find(
          row => row.getBoundingClientRect().bottom > top
        )?.dataset.index;
      });
    await expect.poll(readingRow).toBeDefined();
    const anchor = await readingRow();
    await openHistory(page, shortTitle);
    await expect(viewport.getByText('助手回复 1', { exact: true })).toBeInViewport();
    const thinking = viewport.getByRole('button', { name: '思考过程' });
    await thinking.click();
    await expect(thinking).toHaveAttribute('aria-expanded', 'true');
    await expect.poll(bottomGap).toBeLessThanOrEqual(2);
    await openHistory(page, longTitle);
    await expect.poll(readingRow).toBe(anchor);
    await viewport.evaluate(element => {
      element.scrollTop = 36;
    });
    await expect(firstReply).toBeInViewport();
    await expect(raw).toHaveAttribute('aria-expanded', 'true');
    await expect(edit).toHaveValue('未发送的修改');

    await viewport.evaluate(element => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(latestCopy).toBeInViewport();
    await expect.poll(bottomGap).toBeLessThanOrEqual(2);
    const approval = await page.evaluate(async title => {
      const state = await window.chaptaleDesktop.agentHost.request('state', undefined);
      return {
        cursor: state.cursor + 1,
        kind: 'approval',
        approval: {
          id: 'transcript-approval',
          sessionId: state.sessions.find(session => session.name === title)!.id,
          toolName: 'read',
          input: { path: '场景笔记.txt' },
          cwd: ''
        }
      };
    }, longTitle);
    // 用授权事件验证真正的卡片布局，不发模型请求、不执行工具。
    await workbench.application.evaluate(({ BrowserWindow }, event) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('agent-host:event', event);
    }, approval);
    const authorization = viewport.getByRole('region', { name: 'read 授权', exact: true });
    await expect(authorization.getByRole('button', { name: '拒绝' })).toBeInViewport();
    await expect.poll(bottomGap).toBeLessThanOrEqual(2);
    await expect(page.locator('html')).toHaveAttribute('data-transcript-resize-errors', '0');
  } finally {
    await workbench.dispose(false);
  }
});
