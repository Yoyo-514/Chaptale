import { expect, test } from '@playwright/test';

import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';

import { Workbench } from './fixtures/workbench';

test('全作品搜索按当前输入定位正文，并从事件结果打开资料', async () => {
  const bench = await Workbench.start('work-search');
  try {
    const { page } = bench;
    await expect(page.getByRole('heading', { name: '作品库', exact: true })).toBeVisible();
    await page.evaluate(async () => {
      const api = (window as typeof window & { chaptaleDesktop: ChaptaleDesktopApi }).chaptaleDesktop.creation;
      const work = await api.request('createWork', { commandId: crypto.randomUUID(), title: '渡口', kind: 'novel' });
      if (!work.ok) throw Error(work.error.message);
      const workId = work.value.id;
      const chapter = await api.request('createEntry', {
        commandId: crypto.randomUUID(),
        workId,
        section: 'manuscript',
        kind: 'document',
        format: 'txt',
        parentId: null,
        title: '归舟',
        content: '岸上无人。'
      });
      if (!chapter.ok) throw Error(chapter.error.message);
      const person = await api.request('createEntry', {
        commandId: crypto.randomUUID(),
        workId,
        section: 'resource',
        kind: 'document',
        format: 'txt',
        parentId: null,
        title: '舟子',
        content: '渡船人。'
      });
      if (!person.ok) throw Error(person.error.message);
      const record = await api.request('createRecord', {
        commandId: crypto.randomUUID(),
        workId,
        resourceIds: [person.value.id],
        text: '渡船停航',
        storyTime: '',
        placement: { kind: 'opening' },
        source: { kind: 'author' }
      });
      if (!record.ok) throw Error(record.error.message);
    });
    await page.getByRole('button', { name: '渡口', exact: true }).click();
    await page.getByRole('treeitem', { name: '归舟', exact: true }).click();
    const body = page.getByRole('textbox', { name: '文档正文', exact: true });
    await body.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('归来');
    await page.keyboard.press('Shift+Home');
    await page.keyboard.press('Control+Shift+f');
    const query = page.getByRole('textbox', { name: '搜索当前作品' });
    await expect(query).toHaveValue('归来');
    const panel = page.getByRole('complementary', { name: '全作品搜索' });
    await expect(panel.getByRole('status')).toHaveText('1 篇文档中有 1 个结果');
    await panel.getByRole('button', { name: /2.*归来/ }).click();
    await expect(body).toBeFocused();
    await expect.poll(() => page.evaluate(() => window.getSelection()?.toString())).toBe('归来');
    await query.fill('停航');
    await expect(panel.getByRole('status')).toHaveText('1 条记录中有 1 个结果');
    await panel.getByRole('button', { name: /渡船停航/ }).click();
    const story = page.getByRole('region', { name: '关系与事件', exact: true });
    await expect(story.getByText('渡船停航', { exact: true })).toBeVisible();
    await expect(story.getByRole('listitem').filter({ hasText: '渡船停航' })).toBeFocused();
  } finally {
    await bench.dispose(true);
  }
});

test('全作品替换先保存当前输入，保留划掉的一处，撤销后回到替换前', async () => {
  const bench = await Workbench.start('work-replace');
  try {
    const { page } = bench;
    await expect(page.getByRole('heading', { name: '作品库', exact: true })).toBeVisible();
    const ids = await page.evaluate(async () => {
      const api = (window as typeof window & { chaptaleDesktop: ChaptaleDesktopApi }).chaptaleDesktop.creation;
      const work = await api.request('createWork', { commandId: crypto.randomUUID(), title: '雨夜', kind: 'novel' });
      if (!work.ok) throw Error(work.error.message);
      const create = async (title: string, content: string) => {
        const entry = await api.request('createEntry', {
          commandId: crypto.randomUUID(),
          workId: work.value.id,
          section: 'manuscript',
          kind: 'document',
          format: 'txt',
          parentId: null,
          title,
          content
        });
        if (!entry.ok) throw Error(entry.error.message);
        return entry.value.id;
      };
      return {
        workId: work.value.id,
        first: await create('第一章', '沈霁出城。\n沈霁到渡口。'),
        second: await create('第二章', '沈霁回头。')
      };
    });
    const saved = (documentId: string) =>
      page.evaluate(
        async input => {
          const api = (window as typeof window & { chaptaleDesktop: ChaptaleDesktopApi }).chaptaleDesktop.creation;
          const document = await api.request('readDocument', input);
          if (!document.ok) throw Error(document.error.message);
          return document.value.content;
        },
        { workId: ids.workId, documentId }
      );

    await page.getByRole('button', { name: '雨夜', exact: true }).click();
    await page.getByRole('treeitem', { name: '第二章', exact: true }).click();
    const body = page.getByRole('textbox', { name: '文档正文', exact: true });
    await body.click();
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.insertText('沈霁停步。');

    await page.keyboard.press('Control+Shift+h');
    const panel = page.getByRole('complementary', { name: '全作品搜索' });
    await panel.getByRole('textbox', { name: '搜索当前作品' }).fill('沈霁');
    await panel.getByRole('textbox', { name: '替换为' }).fill('林霁');
    await expect(panel.getByRole('status')).toHaveText('2 篇文档中有 4 个结果');
    await panel.getByRole('button', { name: '这一处保持原文' }).nth(1).click();
    await expect(panel.getByRole('button', { name: '恢复替换这一处' })).toHaveAttribute('aria-pressed', 'true');
    // 点开另一篇文稿查看命中，划掉的记号仍然保留。
    await panel.getByRole('button', { name: /出城/ }).click();
    await expect(page.getByRole('tab', { name: '第一章', exact: true })).toBeVisible();
    await expect(panel.getByRole('button', { name: '恢复替换这一处' })).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('tab', { name: '第二章（未保存）', exact: true }).click();

    await panel.getByRole('button', { name: '全部替换', exact: true }).click();
    const dialog = page.getByRole('alertdialog', { name: '替换全部 3 处？' });
    await dialog.getByRole('button', { name: '保存并替换', exact: true }).click();
    await expect(panel.getByText('已替换 3 处', { exact: true })).toBeVisible();
    await expect(body).toHaveText('林霁回头。\n林霁停步。', { useInnerText: true });
    expect(await saved(ids.first)).toBe('林霁出城。\n沈霁到渡口。');

    await panel.getByRole('button', { name: '撤销上次替换', exact: true }).click();
    await expect(panel.getByText('已撤销上次替换', { exact: true })).toBeVisible();
    await expect(body).toHaveText('沈霁回头。\n沈霁停步。', { useInnerText: true });
    expect(await saved(ids.first)).toBe('沈霁出城。\n沈霁到渡口。');
  } finally {
    await bench.dispose(true);
  }
});
