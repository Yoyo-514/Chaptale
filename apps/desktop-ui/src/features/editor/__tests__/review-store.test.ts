import { getChunks } from '@codemirror/merge';
import { flushPromises, mount } from '@vue/test-utils';
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

import EntryReview from '../review/EntryReview.vue';
import { reviewDone, useReviewStore } from '../review/store';
import { useEditorStore } from '../store';

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
const tabKey = () => `${context.sessionId}:${document.id}`;
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
  const client: Omit<
    ChaptaleDesktopApi['creation'],
    'selectPaths' | 'selectPackageSavePath' | 'fileAction' | 'readFile' | 'pathForFile' | 'addFileData'
  > = {
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
  expect(review.tabs.map(tab => [tab.key, tab.review?.change.id, tab.status])).toEqual([[tabKey(), first.id, 'ready']]);
  expect(review.activeId).toBe('');
  expect(creation.pendingEntryIds.has(document.id)).toBe(true);

  review.close(tabKey());
  review.viewingSessionId = context.sessionId;
  propose('将军出征。\n公主回宫。\n夜深。');
  await flushPromises();
  expect(review.activeId).toBe(tabKey());
  expect(review.activeTab?.review?.candidate.content).toBe('将军出征。\n公主回宫。\n夜深。');
  await flushPromises();
  expect(review.summaries[context.sessionId]?.map(item => 'title' in item && item.title)).toEqual(['序章']);
});

it.each([
  '将军出征。\n公主远行。\n天明。',
  '将军守城。\n公主远行。\n夜深。\n追加。',
  '将军守城。\n夜深。',
  '将军行至城外。\n公主远行。\n夜深。'
])('浮卡计数与编辑器实际正文审阅块一致：%s', async content => {
  review.viewingSessionId = context.sessionId;
  propose(content);
  await flushPromises();
  expect(review.summaries[context.sessionId][0].count).toBe(getChunks(review.getState(tabKey())!)!.chunks.length);
});
it('逐块接受只写入该处，候选其余部分继续待审；拒绝最后一处后标签关闭', async () => {
  propose('将军出征。\n公主远行。\n天明。');
  await flushPromises();
  await review.decide(tabKey(), 'accept', { fromA: 0, toA: 6, fromB: 0, toB: 6 });
  await flushPromises();
  expect(formal().content).toBe('将军出征。\n公主远行。\n夜深。');
  const tab = review.tabs.find(item => item.key === tabKey())!;
  expect(tab.error).toBe('');
  expect(tab.review?.current?.content).toBe('将军出征。\n公主远行。\n夜深。');
  expect(tab.review?.candidate.content).toBe('将军出征。\n公主远行。\n天明。');

  const content = tab.review!.candidate.content!;
  const from = content.indexOf('天明');
  const at = tab.review!.current!.content!.indexOf('夜深');
  await review.decide(tabKey(), 'reject', { fromA: at, toA: at + 3, fromB: from, toB: from + 3 });
  await flushPromises();
  expect(review.tabs).toEqual([]);
  expect(pending()).toEqual([]);
  expect(creation.pendingEntryIds.size).toBe(0);
});

it('手改候选保存后成为新候选，未保存时不能关闭标签', async () => {
  propose('将军出征。\n公主远行。\n夜深。');
  await flushPromises();
  const state = review.getState(tabKey())!;
  review.updateState(tabKey(), state.update({ changes: { from: 0, to: 2, insert: '少帅' } }).state);
  expect(review.activeTab).toBeNull();
  expect(review.tabs[0]!.dirty).toBe(true);
  expect(review.close(tabKey())).toBe(false);
  expect(review.tabs[0]!.error).toContain('未保存的手改');
  await review.save(tabKey());
  await flushPromises();
  expect(review.tabs[0]!.dirty).toBe(false);
  expect(review.tabs[0]!.review?.candidate.content).toBe('少帅出征。\n公主远行。\n夜深。');
  expect(pending()[0]).toMatchObject({ authorEdited: true });
  expect(formal().content).toBe('将军守城。\n公主远行。\n夜深。');
});

it('全部接受按当前会话快照提交并关闭标签', async () => {
  review.viewingSessionId = context.sessionId;
  propose('将军出征。\n公主远行。\n夜深。');
  await flushPromises();
  expect(review.summaries[context.sessionId]).toHaveLength(1);
  await review.decideAll(context.sessionId, 'accept');
  await flushPromises();
  expect(review.batchErrors[context.sessionId]).toBe('');
  expect(formal().content).toBe('将军出征。\n公主远行。\n夜深。');
  expect(review.summaries[context.sessionId]).toEqual([]);
  expect(review.tabs).toEqual([]);
});
function agent<T>(method: string, input: Record<string, unknown>): T {
  const command = { method, input: { commandId: crypto.randomUUID(), workId, ...input } };
  return value(author.executeAgent(context, command as never) as CreationResult<T>);
}
function createResource(title: string, by: 'author' | 'agent') {
  const input = { parentId: null, section: 'resource', kind: 'document', title, format: 'markdown', content: '' };
  if (by === 'author')
    return value(
      author.executeAuthor({
        method: 'createEntry',
        input: { commandId: crypto.randomUUID(), workId, ...input } as never
      })
    ).id;
  return agent<{ change: PendingChange }>('createEntry', input).change.targetId;
}
function proposeRecord(resourceId: string, text: string) {
  return agent<{ change: PendingChange }>('createRecord', {
    resourceIds: [resourceId],
    text,
    source: { kind: 'chapter', chapterId: document.id, revisionId: document.revisionId },
    placement: { kind: 'chapter', chapterId: document.id },
    storyTime: '',
    basis: '将军守城。'
  }).change;
}

it.each(['accept', 'reject'] as const)('资料属性只读对比与整组 %s，正文保留待审', async decision => {
  const resourceId = createResource('沈霁', 'author');
  const initial = value(author.executeAuthor({ method: 'readDocument', input: { workId, documentId: resourceId } }));
  const saved = value(
    author.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: crypto.randomUUID(),
        workId,
        documentId: resourceId,
        expectedRevisionId: initial.revisionId,
        title: initial.title,
        format: initial.format,
        content: '守城的将军。',
        attributes: { type: '人物', aliases: ['阿霁'], tags: ['主角'], cover: null }
      }
    })
  );
  agent('writeContent', {
    documentId: resourceId,
    expectedRevisionId: saved.revisionId,
    content: '出征的将军。',
    attributes: { aliases: ['小沈'], tags: [] }
  });
  await flushPromises();
  await review.open({ sessionId: context.sessionId, entryId: resourceId });
  const key = `${context.sessionId}:${resourceId}`;
  const tab = () => review.tabs.find(item => item.key === key)!;
  const view = mount(EntryReview, { props: { tab: tab() }, global: { plugins: [pinia] } });
  try {
    const attributes = view.find('[aria-label="资料属性修改"]');
    expect(attributes.exists()).toBe(true);
    expect(attributes.text()).toContain('阿霁');
    expect(attributes.text()).toContain('小沈');
    expect(attributes.text()).toContain('主角');
    expect(attributes.text()).toContain('未设置');
    expect(attributes.findAll('input, select, textarea, [contenteditable="true"]')).toHaveLength(0);
    const label = decision === 'accept' ? '接受属性' : '保留原属性';
    const button = attributes.findAll('button').find(item => item.text() === label)!;
    expect(button).toBeDefined();
    await button.trigger('click');
    await flushPromises();
    expect(tab().error).toBe('');
    const expected = decision === 'accept' ? ['小沈'] : ['阿霁'];
    const current = value(author.executeAuthor({ method: 'readDocument', input: { workId, documentId: resourceId } }));
    expect(current.content).toBe('守城的将军。');
    expect(current.attributes?.aliases).toEqual(expected);
    expect(tab().review?.candidate.content).toBe('出征的将军。');
    expect(tab().review?.change.status).toBe('pending');
    await review.decide(key, 'accept');
    await flushPromises();
    const final = value(author.executeAuthor({ method: 'readDocument', input: { workId, documentId: resourceId } }));
    expect(final.content).toBe('出征的将军。');
    expect(final.attributes?.aliases).toEqual(expected);
  } finally {
    view.unmount();
  }
});

it('资料审阅标签列出事件候选，同一会话只在后台打开第一份资料；接受事件时一并提交其新资料', async () => {
  const resourceId = createResource('沈霁', 'agent');
  const other = createResource('柳七', 'agent');
  proposeRecord(resourceId, '沈霁守城');
  proposeRecord(other, '柳七夜入城');
  await flushPromises();
  expect(review.tabs.map(tab => [tab.entryId, tab.section])).toEqual([[resourceId, 'resource']]);
  const key = review.tabs[0]!.key;
  const tab = () => review.tabs.find(item => item.key === key)!;
  expect(tab().review?.candidate.title).toBe('沈霁');
  expect(tab().records.map(change => change.candidate.text)).toEqual(['沈霁守城']);

  await review.decideStory(key, tab().records[0]!, 'accept');
  await flushPromises();
  expect(creation.records.map(record => record.text)).toEqual(['沈霁守城']);
  expect(creation.entries.some(entry => entry.id === resourceId)).toBe(true);
  // 资料处理完后保留标签，提示下一份资料。
  expect(tab()).toMatchObject({ review: null, records: [] });
  expect(review.nextResource(tab())).toEqual({ entryId: other, title: '柳七' });
  await review.openNext(key);
  await flushPromises();
  expect(review.activeTab?.entryId).toBe(other);
  expect(review.activeTab?.records.map(change => change.candidate.text)).toEqual(['柳七夜入城']);
});

it('已有资料的事件候选计入该资料的待审入口，从资料页可打开其审阅标签', async () => {
  const resourceId = createResource('顾长风', 'author');
  await flushPromises();
  expect(creation.pendingStories.has(resourceId)).toBe(false);
  const change = proposeRecord(resourceId, '顾长风守城');
  await flushPromises();
  expect(creation.pendingStories.get(resourceId)?.map(item => item.id)).toEqual([change.id]);
  await review.reveal({ sessionId: change.sessionId, entryId: resourceId });
  await flushPromises();
  expect(review.activeTab).toMatchObject({ entryId: resourceId, review: null });
  expect(review.activeTab?.records.map(item => item.candidate.text)).toEqual(['顾长风守城']);
});

it('新资料的事件改为关联已有资料，新资料候选随之拒绝；作者修改事件候选后接受', async () => {
  const existing = createResource('沈霁', 'author');
  await flushPromises();
  const created = createResource('沈将军', 'agent');
  proposeRecord(created, '沈将军守城');
  await flushPromises();
  const key = `${context.sessionId}:${created}`;
  await review.relink(key, existing);
  await flushPromises();
  expect(review.tabs.find(tab => tab.key === key)).toBeUndefined();
  await review.reveal({ sessionId: context.sessionId, entryId: existing });
  const tab = () => review.activeTab!;
  expect(tab().records.map(change => change.candidate.resourceIds)).toEqual([[existing]]);

  const change = tab().records[0]!;
  await review.updateRecord(tab().key, change, { ...change.candidate, storyTime: '三更' });
  await flushPromises();
  expect(tab().error).toBe('');
  expect(tab().records[0]).toMatchObject({ authorEdited: true, candidate: { storyTime: '三更' } });
  await review.decideStory(tab().key, tab().records[0]!, 'accept');
  await flushPromises();
  expect(creation.records).toMatchObject([{ text: '沈将军守城', storyTime: '三更', resourceIds: [existing] }]);
  expect(pending()).toEqual([]);
});

it('关系候选在双方资料的审阅标签中列出，作者修改称呼后接受，两侧同步清除', async () => {
  const master = createResource('顾长风', 'author');
  const pupil = createResource('林晚', 'author');
  await flushPromises();
  agent('createRelation', {
    resourceIds: [master, pupil],
    type: '师徒',
    directed: true,
    titles: ['师父', '徒弟'],
    milestones: [
      {
        id: null,
        kind: 'start',
        source: { kind: 'chapter', chapterId: document.id, revisionId: document.revisionId },
        placement: { kind: 'chapter', chapterId: document.id },
        storyTime: ''
      }
    ],
    basis: '将军守城。'
  });
  await flushPromises();
  const masterKey = `${context.sessionId}:${master}`;
  await review.open({ sessionId: context.sessionId, entryId: pupil });
  const tab = (key: string) => review.tabs.find(item => item.key === key)!;
  const pupilKey = `${context.sessionId}:${pupil}`;
  expect(tab(masterKey).relations.map(change => change.candidate.type)).toEqual(['师徒']);
  expect(tab(pupilKey).relations.map(change => change.candidate.type)).toEqual(['师徒']);

  const change = tab(masterKey).relations[0]!;
  const editor = useEditorStore();
  await editor.openDocument(master);
  await review.updateRelation(masterKey, change, { ...change.candidate, titles: ['恩师', '徒弟'] });
  await flushPromises();
  expect(tab(pupilKey).relations[0]!.candidate.titles).toEqual(['恩师', '徒弟']);
  await review.decideStory(pupilKey, tab(pupilKey).relations[0]!, 'accept');
  await flushPromises();
  expect(creation.relations.map(relation => relation.titles)).toEqual([['恩师', '徒弟']]);
  // 处理完的资料标签与已打开的同资料文稿标签重复，只留文稿标签。
  expect(review.tabs.some(item => item.key === masterKey)).toBe(false);
  expect(reviewDone(tab(pupilKey))).toBe(true);
  await editor.openDocument(pupil);
  await flushPromises();
  expect(review.tabs).toEqual([]);
  expect(editor.tabs.map(item => item.id)).toEqual([master, pupil]);
});

it('出处是本会话待审正文的事件候选标明章节；整篇拒绝该章时计入一并拒绝的数量', async () => {
  const resourceId = createResource('顾长风', 'author');
  const chapter = propose('将军守城。\n城破。');
  const seen = value(
    author.executeAgent(context, { method: 'readDocument', input: { workId, documentId: document.id } })
  );
  const record = agent<{ change: PendingChange }>('createRecord', {
    resourceIds: [resourceId],
    text: '城破',
    source: { kind: 'chapter', chapterId: document.id, revisionId: seen.revisionId },
    placement: { kind: 'chapter', chapterId: document.id },
    storyTime: '',
    basis: '城破。'
  }).change;
  proposeRecord(resourceId, '顾长风守城');
  await flushPromises();
  await review.open({ sessionId: context.sessionId, entryId: resourceId });
  const tab = review.tabs.find(item => item.entryId === resourceId)!;
  expect([...tab.waiting]).toEqual([[record.id, [document.id]]]);
  const pendingChapter = creation.pendingEntries.find(change => change.id === chapter.id)!;
  expect(review.rejectDependents(pendingChapter)).toBe(1);

  await review.decide(tabKey(), 'reject');
  await flushPromises();
  expect(pending().map(change => change.id)).not.toContain(record.id);
  expect(review.tabs.find(item => item.entryId === resourceId)!.waiting.size).toBe(0);
});

it('关闭当前审阅标签后切到相邻的审阅标签', async () => {
  const resourceId = createResource('顾长风', 'author');
  propose('将军出征。\n公主远行。\n夜深。');
  proposeRecord(resourceId, '顾长风守城');
  await flushPromises();
  await review.open({ sessionId: context.sessionId, entryId: resourceId });
  await review.reveal({ sessionId: context.sessionId, entryId: document.id });
  await review.decide(tabKey(), 'accept');
  await flushPromises();
  expect(review.activeTab?.entryId).toBe(resourceId);
});

it('作者打开的审阅标签在 Agent 补改后显示新候选，不当作手改', async () => {
  propose('将军出征。\n公主远行。\n夜深。');
  await flushPromises();
  await review.reveal({ sessionId: context.sessionId, entryId: document.id });
  const view = mount(EntryReview, { props: { tab: review.activeTab! }, global: { plugins: [pinia] } });
  propose('将军出征。\n公主回宫。\n夜深。');
  await flushPromises();
  // 新候选到达后标签按代次重建，旧编辑器卸载。
  view.unmount();
  expect(review.activeTab?.dirty).toBe(false);
  expect(review.getState(tabKey())!.doc.toString()).toBe('将军出征。\n公主回宫。\n夜深。');
});
