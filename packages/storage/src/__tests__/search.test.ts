import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type {
  CreationAgentContext,
  CreationResult,
  Entry,
  MilestoneInput,
  RecordPlacement
} from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';
import { searchEntries, searchWork } from './fixtures/search.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

async function application() {
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-search-'));
  let app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  return {
    rootDir,
    get app() {
      return app;
    },
    async reopen() {
      app.close();
      app = new CreationApplication(await openCreationStorage({ rootDir }));
    }
  };
}

function createWork(app: CreationApplication) {
  return value(
    app.executeAuthor({
      method: 'createWork',
      input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' }
    })
  );
}

function document(
  app: CreationApplication,
  workId: string,
  title: string,
  content: string,
  section: Entry['section'] = 'manuscript'
) {
  return value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        section,
        kind: 'document',
        title,
        format: 'txt',
        content
      }
    })
  );
}

function search(app: CreationApplication, workId: string, query: string, offset = 0, limit = 10) {
  const page = searchWork(app, { workId, query, offset, limit });
  return { entries: page.hits.flatMap(hit => (hit.kind === 'entry' ? [hit.entry] : [])), hasMore: page.hasMore };
}

const chapter = (chapterId: string): RecordPlacement => ({ kind: 'chapter', chapterId });

function record(
  app: CreationApplication,
  workId: string,
  resourceIds: string[],
  text: string,
  placement: RecordPlacement
) {
  return value(
    app.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds,
        text,
        source: { kind: 'author' },
        placement,
        storyTime: ''
      }
    })
  );
}

function milestone(kind: MilestoneInput['kind'], placement: RecordPlacement, storyTime = ''): MilestoneInput {
  return { id: null, kind, source: { kind: 'author' }, placement, storyTime };
}

function mentorship(
  app: CreationApplication,
  workId: string,
  resourceIds: [string, string],
  milestones: MilestoneInput[]
) {
  return value(
    app.executeAuthor({
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds,
        type: '师徒',
        directed: true,
        titles: ['师父', '徒弟'],
        milestones
      }
    })
  );
}

function aliases(app: CreationApplication, workId: string, entry: Entry, names: string[]) {
  return value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        title: entry.title,
        format: 'txt',
        content: '人物资料。',
        attributes: { type: '人物', aliases: names, tags: [], cover: null }
      }
    })
  );
}

/** 三章与两份资料：沈霁在第一章救下顾长风（别名长风），第三章收他为徒。 */
function story(app: CreationApplication) {
  const work = createWork(app);
  const first = document(app, work.id, '雨夜', '沈霁在城门外等候。');
  const second = document(app, work.id, '渡口', '船在渡口停了一夜。');
  const third = document(app, work.id, '拜师', '顾长风在城门下拜师。');
  const shen = document(app, work.id, '沈霁', '镇守城门多年的将领。', 'resource');
  const gu = aliases(app, work.id, document(app, work.id, '顾长风', '', 'resource'), ['长风']);
  return { work, first, second, third, shen, gu };
}

it('中文全文检索匹配标题和正文，只返回指定作品的正式文稿及资料', async () => {
  const { app } = await application();
  const work = createWork(app);
  const other = createWork(app);
  const night = document(app, work.id, '雨夜', '城门外的将军正在等候。');
  const resource = document(app, work.id, '将军', '守城的人物资料。', 'resource');
  document(app, other.id, '将军', '属于另一部作品。');
  const page = search(app, work.id, '将军');
  expect(page.entries).toHaveLength(2);
  expect(page.entries.map(entry => entry.id)).toEqual(expect.arrayContaining([night.id, resource.id]));
  expect(page.hasMore).toBe(false);
  expect(page.entries.find(entry => entry.id === night.id)).toMatchObject({
    revisionId: night.revisionId,
    title: '雨夜'
  });
  expect(value(app.executeAuthor({ method: 'listWorks', input: {} }))).toHaveLength(2);
  expect(value(app.executeAuthor({ method: 'listEntries', input: { workId: work.id } }))).toHaveLength(2);
  expect(searchEntries(app, { workId: work.id, query: '将军', section: 'resource' }).map(entry => entry.id)).toEqual([
    resource.id
  ]);
});

it('正文命中返回段落原文与行号，只命中标题时没有段落', async () => {
  const { app } = await application();
  const work = createWork(app);
  const filler = '雨'.repeat(400);
  const content = [filler, '将军在城门等候。', '', '将军没有等到人。', filler, '公主远行。'].join('\n');
  const night = document(app, work.id, '雨夜', content);
  const resource = document(app, work.id, '将军', '守城的人物资料。', 'resource');
  const { hits } = searchWork(app, { workId: work.id, query: '将军' });
  expect(hits).toHaveLength(2);
  expect(hits).toEqual(
    expect.arrayContaining([
      {
        kind: 'entry',
        entry: night,
        pending: false,
        ignoresAsOf: false,
        passages: [{ startLine: 2, endLine: 4, text: '将军在城门等候。\n\n将军没有等到人。' }]
      },
      { kind: 'entry', entry: resource, pending: false, ignoresAsOf: false, passages: [] }
    ])
  );
  // 行号与按行读取正文一致。
  const [passage] = hits.flatMap(hit => (hit.kind === 'entry' ? hit.passages : []));
  expect(
    content
      .split('\n')
      .slice(passage!.startLine - 1, passage!.endLine)
      .join('\n')
  ).toBe(passage!.text);
});

it('一个条目最多返回三段，含查询词多的段落优先，按原文顺序排列', async () => {
  const { app } = await application();
  const work = createWork(app);
  const filler = '雨'.repeat(400);
  const lines = [1, 2, 3, 4].map(() => `将军巡营。${filler}`);
  document(app, work.id, '巡营', [...lines, `Alice 见到将军。${filler}`].join('\n'));
  const lineRanges = (query: string) =>
    searchWork(app, { workId: work.id, query }).hits.flatMap(hit =>
      hit.kind === 'entry' ? hit.passages.map(passage => [passage.startLine, passage.endLine]) : []
    );
  expect(lineRanges('将军')).toEqual([
    [1, 1],
    [2, 2],
    [3, 3]
  ]);
  expect(lineRanges('Alice 将军')).toEqual([
    [1, 1],
    [2, 2],
    [5, 5]
  ]);
});

it('短名、别名和重名都能检索到，重名条目各自返回', async () => {
  const { app } = await application();
  const work = createWork(app);
  const chapterEntry = document(app, work.id, '阿霁', '阿霁推开门，看见长风站在雪里。');
  const namesake = document(app, work.id, '阿霁', '', 'resource');
  const gu = aliases(app, work.id, document(app, work.id, '顾长风', '', 'resource'), ['长风']);
  expect(
    search(app, work.id, '阿霁')
      .entries.map(entry => entry.id)
      .sort()
  ).toEqual([chapterEntry.id, namesake.id].sort());
  expect(
    search(app, work.id, '长风')
      .entries.map(entry => entry.id)
      .sort()
  ).toEqual([chapterEntry.id, gu.id].sort());
  expect(
    search(app, work.id, '霁')
      .entries.map(entry => entry.id)
      .sort()
  ).toEqual([chapterEntry.id, namesake.id].sort());
});

it('关键词按字面连续匹配，不跨标点和换行；多个关键词用空格或标点分隔', async () => {
  const { app } = await application();
  const work = createWork(app);
  const dialogue = document(app, work.id, '对话', '沈霁说：“走吧。”\n沈霁道：“不必。”');
  const rescue = document(app, work.id, '救人', '沈霁在城门外救下少年。');
  document(app, work.id, '城楼', '他救了人，然后走下城楼。');
  document(app, work.id, '军令', '他是军中大将。军令如山。\n那位老\n兵没有回头。');
  const oath = document(app, work.id, '拜师', '顾长风在城门下拜师，沈霁点头。');
  const found = (query: string) =>
    search(app, work.id, query)
      .entries.map(entry => entry.id)
      .sort();

  // 紧跟在人名后的“说”“道”“在”不影响按人名检索。
  expect(found('沈霁')).toEqual([dialogue.id, rescue.id, oath.id].sort());
  // 两个字各自出现在别处不算命中。
  expect(found('救下')).toEqual([rescue.id]);
  expect(found('将军')).toEqual([]);
  expect(found('老兵')).toEqual([]);
  // 连写的几个词是一个关键词，原文里没有连在一起就搜不到。
  expect(found('沈霁拜师')).toEqual([]);
  expect(found('沈霁 拜师')).toEqual([oath.id]);
  expect(found('沈霁，拜师')).toEqual([oath.id]);
  expect(found('“走吧。”')).toEqual([dialogue.id]);
});

it('标题与别名、涉及的各份资料之间不连成一个关键词', async () => {
  const { app } = await application();
  const { work, first, shen, gu } = story(app);
  aliases(app, work.id, shen, ['顾盼']);
  record(app, work.id, [shen.id, gu.id], '两人在渡口分别。', chapter(first.id));
  expect(
    searchWork(app, { workId: work.id, query: '顾盼' })
      .hits.map(hit => hit.kind)
      .sort()
  ).toEqual(['entry', 'record']);
  // “沈霁”与别名“顾盼”、“顾盼”与另一份资料“顾长风”相邻存放，但不是连续的文字。
  expect(searchWork(app, { workId: work.id, query: '霁顾' }).hits).toEqual([]);
  expect(searchWork(app, { workId: work.id, query: '盼顾' }).hits).toEqual([]);
});

it('事件和关系按文本、涉及资料的标题与别名检索，返回记录本身和发生位置', async () => {
  const { app } = await application();
  const { work, first, third, shen, gu } = story(app);
  const rescue = record(app, work.id, [shen.id, gu.id], '沈霁在城门外救下少年。', chapter(first.id));
  const relation = mentorship(app, work.id, [shen.id, gu.id], [milestone('start', chapter(third.id), '景和三年冬')]);

  expect(searchWork(app, { workId: work.id, query: '救下' }).hits).toEqual([
    {
      kind: 'record',
      record: { ...rescue, sourceChanged: false, pending: false }
    }
  ]);
  // 事件正文没有写“长风”，按涉及资料的别名找到。
  const byAlias = searchWork(app, { workId: work.id, query: '长风' }).hits;
  expect(byAlias.filter(hit => hit.kind === 'record')).toMatchObject([{ record: { id: rescue.id } }]);
  expect(byAlias.filter(hit => hit.kind === 'relation')).toMatchObject([{ relation: { id: relation.id } }]);
  const entryHits = byAlias.filter(hit => hit.kind === 'entry');
  expect(entryHits).toHaveLength(2);
  expect(entryHits).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ entry: expect.objectContaining({ id: gu.id }), passages: [] }),
      expect.objectContaining({
        entry: expect.objectContaining({ id: third.id }),
        passages: [{ startLine: 1, endLine: 1, text: '顾长风在城门下拜师。' }]
      })
    ])
  );

  expect(searchWork(app, { workId: work.id, query: '师徒' }).hits).toMatchObject([
    {
      kind: 'relation',
      relation: {
        id: relation.id,
        resourceIds: [shen.id, gu.id],
        state: 'active',
        pending: false,
        milestones: [{ kind: 'start', placement: chapter(third.id), sourceChanged: false }]
      }
    }
  ]);
  expect(searchWork(app, { workId: work.id, query: '景和' }).hits).toMatchObject([{ kind: 'relation' }]);
  // 限定分区时只检索条目。
  expect(searchWork(app, { workId: work.id, query: '长风', section: 'resource' }).hits).toMatchObject([
    { kind: 'entry', entry: { id: gu.id } }
  ]);
  expect(searchWork(app, { workId: work.id, query: '救下', section: 'manuscript' }).hits).toEqual([]);
});

it('只到某一章：之后的章节、事件和关系变化不返回，位置待定的照常返回，资料不随进度', async () => {
  const { app } = await application();
  const { work, first, second, third, shen, gu } = story(app);
  const before = record(app, work.id, [shen.id], '沈霁少时在城门当值。', { kind: 'opening' });
  const rescue = record(app, work.id, [shen.id, gu.id], '沈霁在城门外救下少年。', chapter(first.id));
  const oath = record(app, work.id, [shen.id, gu.id], '两人在城门下立誓。', chapter(third.id));
  const undetermined = record(app, work.id, [gu.id], '顾长风重回城门。', { kind: 'undetermined' });
  const relation = mentorship(
    app,
    work.id,
    [shen.id, gu.id],
    [milestone('start', chapter(second.id)), milestone('end', chapter(third.id))]
  );
  const ids = (asOf?: string) =>
    searchWork(app, { workId: work.id, query: '城门', ...(asOf && { asOf }) }).hits.map(hit =>
      hit.kind === 'entry' ? hit.entry.id : hit.kind === 'record' ? hit.record.id : hit.relation.id
    );

  expect(ids().sort()).toEqual([first.id, third.id, shen.id, before.id, rescue.id, oath.id, undetermined.id].sort());
  expect(ids(first.id).sort()).toEqual([first.id, shen.id, before.id, rescue.id, undetermined.id].sort());
  expect(ids(third.id).sort()).toEqual(ids().sort());

  const resourceHit = (asOf?: string) =>
    searchWork(app, { workId: work.id, query: '城门', ...(asOf && { asOf }) }).hits.find(
      hit => hit.kind === 'entry' && hit.entry.id === shen.id
    );
  expect(resourceHit(first.id)).toMatchObject({ ignoresAsOf: true });
  expect(resourceHit()).toMatchObject({ ignoresAsOf: false });

  // 关系在第二章建立、第三章结束：第一章时还不存在，第二章时持续且看不到之后的结束。
  const relations = (asOf?: string) =>
    searchWork(app, { workId: work.id, query: '师徒', ...(asOf && { asOf }) }).hits.flatMap(hit =>
      hit.kind === 'relation' ? [hit.relation] : []
    );
  expect(relations(first.id)).toEqual([]);
  expect(relations(second.id)).toMatchObject([{ id: relation.id, state: 'active', milestones: [{ kind: 'start' }] }]);
  expect(relations(second.id)[0]!.milestones).toHaveLength(1);
  expect(relations()).toMatchObject([
    { id: relation.id, state: 'ended', milestones: [{ kind: 'start' }, { kind: 'end' }] }
  ]);

  for (const asOf of [shen.id, 'missing'])
    expect(
      app.executeAgent(
        { sessionId: 'session-a', mode: 'discuss' },
        { method: 'searchWork', input: { workId: work.id, query: '城门', asOf, offset: 0, limit: 10 } }
      )
    ).toMatchObject({ ok: false, error: { message: '查看进度的章节不存在' } });
});

it('本会话待接受的事件和关系参与检索，其他会话和正式检索看不到；待移除的不再返回', async () => {
  const { app } = await application();
  const { work, first, shen, gu } = story(app);
  const formal = record(app, work.id, [shen.id], '沈霁在城门外救下少年。', chapter(first.id));
  const context: CreationAgentContext = { sessionId: 'session-a', mode: 'review' };
  const other: CreationAgentContext = { sessionId: 'session-b', mode: 'review' };
  const proposed = value(
    app.executeAgent(context, {
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        resourceIds: [gu.id],
        text: '少年在渡口留下一封信。',
        source: { kind: 'author' },
        placement: chapter(first.id),
        storyTime: '',
        basis: '作者口述'
      }
    })
  );
  if (proposed.kind !== 'pending' || proposed.change.target !== 'record') throw new Error('预期生成待接受的事件');
  value(
    app.executeAgent(context, {
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        resourceIds: [shen.id, gu.id],
        type: '师徒',
        directed: true,
        titles: ['师父', '徒弟'],
        milestones: [milestone('start', chapter(first.id))],
        basis: '作者口述'
      }
    })
  );
  value(
    app.executeAgent(context, {
      method: 'removeRecord',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        recordId: formal.id,
        expectedRevisionId: formal.revisionId,
        basis: '作者要求删去'
      }
    })
  );
  const letter = { workId: work.id, query: '一封信' };
  expect(searchWork(app, letter, context).hits).toMatchObject([
    { kind: 'record', record: { id: proposed.change.targetId, revisionId: proposed.change.version, pending: true } }
  ]);
  expect(searchWork(app, letter, other).hits).toEqual([]);
  expect(searchWork(app, letter).hits).toEqual([]);

  const mentor = { workId: work.id, query: '师徒' };
  expect(searchWork(app, mentor, context).hits).toMatchObject([{ kind: 'relation', relation: { pending: true } }]);
  expect(searchWork(app, mentor, other).hits).toEqual([]);

  const rescue = { workId: work.id, query: '救下' };
  expect(searchWork(app, rescue, context).hits).toEqual([]);
  expect(searchWork(app, rescue, other).hits).toMatchObject([{ kind: 'record', record: { id: formal.id } }]);
});

it('只到某一章时，本会话改写的后续章节同样不返回', async () => {
  const { app } = await application();
  const { work, first, third } = story(app);
  const context: CreationAgentContext = { sessionId: 'session-a', mode: 'review' };
  value(
    app.executeAgent(context, {
      method: 'writeDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: third.id,
        expectedRevisionId: third.revisionId,
        title: third.title,
        format: 'txt',
        content: '顾长风在渡口拜师。'
      }
    })
  );
  const query = { workId: work.id, query: '拜师' };
  expect(searchWork(app, query, context).hits).toMatchObject([
    { kind: 'entry', entry: { id: third.id }, pending: true, passages: [{ text: '顾长风在渡口拜师。' }] }
  ]);
  expect(searchWork(app, { ...query, asOf: first.id }, context).hits).toEqual([]);
});

it('正式保存与标题修改更新索引，恢复草稿不参与检索，重启后结果保留', async () => {
  const fixture = await application();
  const { app } = fixture;
  const work = createWork(app);
  const entry = document(app, work.id, '旧标题', '将军正在守城。');
  value(
    app.executeAuthor({
      method: 'writeDraft',
      input: {
        workId: work.id,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        draftId: randomUUID(),
        expectedDraftVersion: null,
        title: '旧标题',
        format: 'txt',
        content: '公主回城。'
      }
    })
  );
  expect(search(app, work.id, '公主').entries).toEqual([]);
  const saved = value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        title: '新标题',
        format: 'txt',
        content: '公主正在远行。'
      }
    })
  );
  expect(search(app, work.id, '将军').entries).toEqual([]);
  expect(search(app, work.id, '旧标题').entries).toEqual([]);
  expect(search(app, work.id, '公主').entries).toEqual([saved]);
  expect(search(app, work.id, '新标题').entries).toEqual([saved]);
  await fixture.reopen();
  expect(search(fixture.app, work.id, '公主').entries).toEqual([saved]);
  expect(
    value(fixture.app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: saved.id } }))
      .content
  ).toBe('公主正在远行。');
});

it('检索稳定分页，中英混合多词使用交集，标点和 MATCH 语法不被解释', async () => {
  const { app } = await application();
  const work = createWork(app);
  const first = document(app, work.id, '夜行', 'Alice 在城门见到将军。');
  const second = document(app, work.id, '守城', 'Alice 与将军告别。');
  document(app, work.id, '清晨', 'Bob 在城门驻守。');
  const page1 = search(app, work.id, 'Alice 将军', 0, 1);
  const page2 = search(app, work.id, 'Alice 将军', 1, 1);
  expect(page1.hasMore).toBe(true);
  expect(page2.hasMore).toBe(false);
  expect(page1.entries).toHaveLength(1);
  expect(page2.entries).toHaveLength(1);
  expect(page1.entries[0]!.id).not.toBe(page2.entries[0]!.id);
  expect([...page1.entries, ...page2.entries].map(entry => entry.id)).toEqual(
    expect.arrayContaining([first.id, second.id])
  );
  expect(search(app, work.id, 'alice 将军').entries).toHaveLength(2);
  expect(search(app, work.id, '" : * ()').entries).toEqual([]);
  expect(search(app, work.id, 'Alice OR Bob').entries).toEqual([]);
  expect(search(app, work.id, '将军', 10, 1)).toEqual({ entries: [], hasMore: false });
});

it('条目、事件和关系混排时按命中数分页', async () => {
  const { app } = await application();
  const { work, first, shen, gu } = story(app);
  record(app, work.id, [shen.id, gu.id], '沈霁在城门外救下少年。', chapter(first.id));
  const all = searchWork(app, { workId: work.id, query: '沈霁' }).hits;
  expect(all.map(hit => hit.kind).sort()).toEqual(['entry', 'entry', 'record']);
  const pages = [0, 1, 2].map(offset => searchWork(app, { workId: work.id, query: '沈霁', offset, limit: 1 }));
  expect(pages.map(page => page.hasMore)).toEqual([true, true, false]);
  expect(pages.flatMap(page => page.hits)).toEqual(all);
});

it('回执写入失败时正文与索引一起回滚，同一命令重试只提交一次', async () => {
  const { app, rootDir } = await application();
  const work = createWork(app);
  const entry = document(app, work.id, '守城', '将军守城。');
  const input = {
    commandId: randomUUID(),
    workId: work.id,
    documentId: entry.id,
    expectedRevisionId: entry.revisionId,
    title: '守城',
    format: 'txt' as const,
    content: '公主远行。'
  };
  const fault = new Database(join(rootDir, 'works', work.id, 'work.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_receipt BEFORE INSERT ON command_receipts BEGIN SELECT RAISE(ABORT, '回执故障'); END"
    );
    expect(app.executeAuthor({ method: 'saveDocument', input })).toMatchObject({
      ok: false,
      error: { message: '回执故障' }
    });
    expect(search(app, work.id, '将军').entries).toEqual([entry]);
    expect(search(app, work.id, '公主').entries).toEqual([]);
    expect(
      value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: entry.id } })).content
    ).toBe('将军守城。');
    fault.exec('DROP TRIGGER fail_receipt');
    const saved = value(app.executeAuthor({ method: 'saveDocument', input }));
    expect(value(app.executeAuthor({ method: 'saveDocument', input }))).toEqual(saved);
    expect(search(app, work.id, '公主').entries).toEqual([saved]);
    expect(search(app, work.id, '将军').entries).toEqual([]);
  } finally {
    fault.close();
  }
});

it.each([
  { query: '', offset: 0, limit: 10 },
  { query: '  \n', offset: 0, limit: 10 },
  { query: '将军', offset: -1, limit: 10 },
  { query: '将军', offset: 0, limit: 0 },
  { query: '将军', offset: 0, limit: 1.5 },
  { query: '将军', offset: 0, limit: 10, section: 'other' },
  { query: '将军', offset: 0, limit: 10, asOf: '' }
])('搜索边界拒绝无效请求：%j', async input => {
  const { app } = await application();
  expect(
    app.executeAgent(
      { sessionId: 'session-a', mode: 'discuss' },
      { method: 'searchWork', input: { workId: 'work', ...input } }
    )
  ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
});
