import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';
import { openCreationStorage } from '@chaptale/storage';

import { useCreationStore } from '@/features/creation';

import { useEditorContext } from '../context';
import { useHistoryStore } from '../history/store';
import ReadingView from '../reading/ReadingView.vue';
import { useReadingStore } from '../reading/store';
import { useReviewStore } from '../review/store';
import { useEditorStore } from '../store';

let root: string;
let author: CreationApplication;
let pinia: Pinia;
let creation: ReturnType<typeof useCreationStore>;
let workId: string;
let wrapper: VueWrapper | undefined;

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function chapter(title: string, content: string) {
  const entry = value(
    author.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: crypto.randomUUID(),
        workId,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title,
        format: 'txt',
        content
      }
    })
  );
  await flushPromises();
  return entry;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-editor-context-'));
  author = new CreationApplication(await openCreationStorage({ rootDir: root }));
  workId = value(
    author.executeAuthor({
      method: 'createWork',
      input: {
        commandId: crypto.randomUUID(),
        title: '长夜行',
        kind: 'novel'
      }
    })
  ).id;
  const client: Omit<
    ChaptaleDesktopApi['creation'],
    'selectPaths' | 'selectPackageSavePath' | 'fileAction' | 'readFile' | 'pathForFile' | 'addFileData'
  > = {
    request: (method, input) => author.execute({ method, input: structuredClone(input) }),
    subscribe: listener => author.subscribe(listener),
    onDisconnected: () => () => {}
  };
  Object.defineProperty(window, 'chaptaleDesktop', { configurable: true, value: { creation: client } });
  pinia = createPinia();
  setActivePinia(pinia);
  creation = useCreationStore();
  await creation.connect();
  await creation.openWork(workId);
});

afterEach(async () => {
  wrapper?.unmount();
  wrapper = undefined;
  window.getSelection()?.removeAllRanges();
  disposePinia(pinia);
  author.close();
  Reflect.deleteProperty(window, 'chaptaleDesktop');
  await rm(root, { recursive: true, force: true });
});

it('分栏按最后焦点捕获标签与选区，保留 BOM 与混合换行，遇到未保存修改先提示保存', async () => {
  const first = await chapter('第三回', '\uFEFF甲\r\n乙\n丙');
  const second = await chapter('第四回', '另一章');
  const editor = useEditorStore();
  await editor.openDocument(first.id);
  await editor.openDocument(second.id);
  creation.view!.secondaryDocumentId = first.id;
  editor.focusedId = first.id;
  const buffer = editor.getBuffer(first.id)!;
  buffer.update(buffer.state.update({ selection: { anchor: 0, head: 3 } }).state);
  const source = useEditorContext();
  const captured = await source.prepare(null);
  expect(captured).toEqual({
    ok: true,
    context: {
      workId,
      entryId: first.id,
      title: '第三回',
      section: 'manuscript',
      selection: '甲\r\n乙'
    }
  });

  buffer.update(
    buffer.state.update({ changes: { from: 0, to: 1, insert: '改' }, selection: { anchor: 0, head: 3 } }).state
  );
  editor.updateBuffer(first.id, buffer);

  const cancelled = source.prepare(null);
  await flushPromises();
  expect(editor.unsavedPrompt).toEqual({ titles: ['第三回'], discard: false });
  editor.resolveUnsaved('cancel');
  expect(await cancelled).toEqual({ ok: false });

  const saved = source.prepare(null);
  await flushPromises();
  editor.resolveUnsaved('save');
  expect(await saved).toEqual({
    ok: true,
    context: {
      workId,
      entryId: first.id,
      title: '第三回',
      section: 'manuscript',
      selection: '改\r\n乙'
    }
  });
  expect(editor.tabs.find(tab => tab.id === first.id)!.dirty).toBe(false);
});

it('本会话审阅标签有未保存手改时先提示保存，外会话候选与历史标签不自动附带上下文', async () => {
  const entry = await chapter('第三回', '将军守城。');
  const editor = useEditorStore();
  await editor.openDocument(entry.id);
  const proposed = value(
    author.executeAgent(
      { sessionId: 'session-a', mode: 'review' },
      {
        method: 'writeDocument',
        input: {
          commandId: crypto.randomUUID(),
          workId,
          documentId: entry.id,
          expectedRevisionId: entry.revisionId,
          title: entry.title,
          format: 'txt',
          content: '将军出征。'
        }
      }
    )
  );
  if (proposed.kind !== 'pending') throw new Error('预期生成候选');
  await flushPromises();
  const review = useReviewStore();
  await review.reveal({ sessionId: 'session-a', entryId: entry.id });
  const key = review.activeTab!.key;
  const state = review.getState(key)!;
  review.updateState(
    key,
    state.update({ changes: { from: 0, to: 2, insert: '少帅' }, selection: { anchor: 0, head: 2 } }).state
  );
  const source = useEditorContext();

  expect(await source.prepare('session-b')).toEqual({ ok: true });

  const preparing = source.prepare('session-a');
  await flushPromises();
  expect(editor.unsavedPrompt).toEqual({ titles: ['第三回'], discard: false });
  editor.resolveUnsaved('save');
  expect(await preparing).toEqual({
    ok: true,
    context: {
      workId,
      entryId: entry.id,
      title: '第三回',
      section: 'manuscript',
      selection: '少帅'
    }
  });
  expect(review.activeTab!.dirty).toBe(false);

  const history = useHistoryStore();
  history.open(entry.id);
  await flushPromises();
  expect(await source.prepare('session-a')).toEqual({ ok: true });
});

it('阅读跨章后按屏幕当前章节与选中原文附带上下文，原编辑标签保持不变', async () => {
  const first = await chapter('第三回', '将军守城。');
  const second = await chapter('第四回', '公主远行。');
  const editor = useEditorStore();
  await editor.openDocument(first.id);
  const reading = useReadingStore();
  const source = useEditorContext();
  reading.start(first.id);
  wrapper = mount(ReadingView, { props: { tab: editor.activeTab! }, global: { plugins: [pinia] } });
  await flushPromises();
  expect(wrapper.text()).toContain('将军守城。');
  expect(await source.prepare(null)).toEqual({
    ok: true,
    context: {
      workId,
      entryId: first.id,
      title: '第三回',
      section: 'manuscript'
    }
  });
  await wrapper
    .findAll('button')
    .find(button => button.text() === '下一页')!
    .trigger('click');
  await flushPromises();
  expect(wrapper.text()).toContain('公主远行。');
  const block = wrapper.find('.reading-block').element;
  const walker = document.createTreeWalker(block, NodeFilter.SHOW_TEXT);
  const textNode = walker.nextNode()!;
  const range = document.createRange();
  range.setStart(textNode, 0);
  range.setEnd(textNode, 4);
  const selection = window.getSelection()!;
  selection.removeAllRanges();
  selection.addRange(range);
  expect(await source.prepare(null)).toEqual({
    ok: true,
    context: {
      workId,
      entryId: second.id,
      title: '第四回',
      section: 'manuscript',
      selection: '公主远行'
    }
  });
  expect(editor.tabs.map(tab => tab.id)).toEqual([first.id]);
});
