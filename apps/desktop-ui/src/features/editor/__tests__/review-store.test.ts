import { flushPromises } from '@vue/test-utils';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, Document, PendingChange } from '@chaptale/creation/contracts';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';
import { openCreationStorage } from '@chaptale/storage';

import { useCreationStore } from '@/features/creation';

import { useReviewStore } from '../review/store';

let root: string;
let author: CreationApplication;
let pinia: Pinia;
let creation: ReturnType<typeof useCreationStore>;
let review: ReturnType<typeof useReviewStore>;
let workId: string;
let document: Document;
const context = { sessionId: 'session-a', mode: 'review' as const };

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
function propose(content: string, title = document.title): PendingChange {
  // Agent 读到的是本会话候选视图，补改沿用该视图的修订。
  const seen = value(
    author.executeAgent(context, { method: 'readDocument', input: { workId, documentId: document.id } })
  );
  const result = value(
    author.executeAgent(context, {
      method: 'writeDocument',
      input: {
        commandId: crypto.randomUUID(),
        workId,
        documentId: document.id,
        expectedRevisionId: seen.revisionId,
        title,
        format: 'txt',
        content
      }
    })
  );
  if (result.kind !== 'pending') throw new Error('预期生成待接受修改');
  return result.change;
}
function formal() {
  return value(author.executeAuthor({ method: 'readDocument', input: { workId, documentId: document.id } }));
}
function pending() {
  return value(author.executeAuthor({ method: 'listPendingChanges', input: { workId, sessionId: null } }));
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-review-store-'));
  author = new CreationApplication(await openCreationStorage({ rootDir: root }));
  workId = value(
    author.executeAuthor({
      method: 'createWork',
      input: { commandId: crypto.randomUUID(), title: '长夜行', kind: 'novel' }
    })
  ).id;
  const entry = value(
    author.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: crypto.randomUUID(),
        workId,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '序章',
        format: 'txt',
        content: '将军守城。\n公主远行。\n夜深。'
      }
    })
  );
  document = value(author.executeAuthor({ method: 'readDocument', input: { workId, documentId: entry.id } }));
  const client: Omit<ChaptaleDesktopApi['creation'], 'selectPaths'> = {
    // 与 IPC 一致：参数先经过结构化克隆
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
  review = useReviewStore();
});
afterEach(async () => {
  disposePinia(pinia);
  author.close();
  Reflect.deleteProperty(window, 'chaptaleDesktop');
  await rm(root, { recursive: true, force: true });
});

it('Agent 写入后审阅标签在后台打开；作者正在看该会话且焦点不在编辑区时切到前台', async () => {
  const first = propose('将军出征。\n公主远行。\n夜深。');
  await flushPromises();
  expect(review.tabs.map(tab => [tab.changeId, tab.status])).toEqual([[first.id, 'ready']]);
  expect(review.activeId).toBe('');
  expect(creation.pendingEntryIds.has(document.id)).toBe(true);

  review.close(first.id);
  review.viewingSessionId = context.sessionId;
  propose('将军出征。\n公主回宫。\n夜深。');
  await flushPromises();
  expect(review.activeId).toBe(first.id);
  expect(review.activeTab?.review?.candidate.content).toBe('将军出征。\n公主回宫。\n夜深。');
  await flushPromises();
  expect(review.summaries[context.sessionId]?.[0]?.items.map(item => item.title)).toEqual(['序章']);
});

it('逐块接受只写入该处，候选其余部分继续待审；拒绝最后一处后标签关闭', async () => {
  const change = propose('将军出征。\n公主远行。\n天明。');
  await flushPromises();
  await review.decide(change.id, 'accept', { fromA: 0, toA: 6, fromB: 0, toB: 6 });
  await flushPromises();
  expect(formal().content).toBe('将军出征。\n公主远行。\n夜深。');
  const tab = review.tabs.find(item => item.changeId === change.id)!;
  expect(tab.error).toBe('');
  expect(tab.review?.current?.content).toBe('将军出征。\n公主远行。\n夜深。');
  expect(tab.review?.candidate.content).toBe('将军出征。\n公主远行。\n天明。');

  const content = tab.review!.candidate.content!;
  const from = content.indexOf('天明');
  const at = tab.review!.current!.content!.indexOf('夜深');
  await review.decide(change.id, 'reject', { fromA: at, toA: at + 3, fromB: from, toB: from + 3 });
  await flushPromises();
  expect(review.tabs).toEqual([]);
  expect(pending()).toEqual([]);
  expect(creation.pendingEntryIds.size).toBe(0);
});

it('手改候选保存后成为新候选，未保存时不能关闭标签', async () => {
  const change = propose('将军出征。\n公主远行。\n夜深。');
  await flushPromises();
  const state = review.getState(change.id)!;
  review.updateState(change.id, state.update({ changes: { from: 0, to: 2, insert: '少帅' } }).state);
  expect(review.activeTab).toBeNull();
  expect(review.tabs[0]!.dirty).toBe(true);
  expect(review.close(change.id)).toBe(false);
  expect(review.tabs[0]!.error).toContain('未保存的手改');
  await review.save(change.id);
  await flushPromises();
  expect(review.tabs[0]!.dirty).toBe(false);
  expect(review.tabs[0]!.review?.candidate.content).toBe('少帅出征。\n公主远行。\n夜深。');
  expect(pending()[0]).toMatchObject({ authorEdited: true });
  expect(formal().content).toBe('将军守城。\n公主远行。\n夜深。');
});

it('整组接受写入全部修改并关闭标签；结束任务后修改转入早前任务', async () => {
  review.viewingSessionId = context.sessionId;
  propose('将军出征。\n公主远行。\n夜深。');
  await flushPromises();
  let [summary] = review.summaries[context.sessionId]!;
  await review.endTask(summary!);
  await flushPromises();
  [summary] = review.summaries[context.sessionId]!;
  expect(summary!.group.status).toBe('ended');
  expect(review.deliveryErrors[context.sessionId]).toBe('');

  await review.decideGroup(summary!, 'accept');
  await flushPromises();
  expect(review.deliveryErrors[context.sessionId]).toBe('');
  expect(formal().content).toBe('将军出征。\n公主远行。\n夜深。');
  expect(review.summaries[context.sessionId]).toEqual([]);
  expect(review.tabs).toEqual([]);
});
