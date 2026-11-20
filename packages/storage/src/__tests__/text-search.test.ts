import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, Entry, TextSearchInput, TextSearchResult } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

let rootDir: string;
let app: CreationApplication;
let workId: string;
beforeEach(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'chaptale-text-search-'));
  app = new CreationApplication(await openCreationStorage({ rootDir }));
  workId = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  ).id;
});
afterEach(async () => {
  app.close();
  await rm(rootDir, { recursive: true, force: true });
});

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

/** content 为 null 时建目录。 */
function entry(
  title: string,
  content: string | null,
  section: Entry['section'] = 'manuscript',
  parentId: string | null = null
) {
  const target = { commandId: randomUUID(), workId, parentId, section, title };
  return value(
    app.executeAuthor({
      method: 'createEntry',
      input:
        content === null ? { ...target, kind: 'directory' } : { ...target, kind: 'document', format: 'txt', content }
    })
  );
}

const search = (pattern: string, options: Partial<TextSearchInput> = {}) =>
  app.executeAuthor({
    method: 'searchText',
    input: {
      workId,
      pattern,
      caseSensitive: false,
      wholeWord: false,
      regexp: false,
      unsaved: [],
      replacement: null,
      ...options
    }
  });
/** 每处命中在所在行里的文字。 */
const found = (result: TextSearchResult) =>
  result.entries.map(({ entryId, matches }) => [
    entryId,
    matches.map(
      match => `${match.line}:${match.excerpt.slice(match.excerptFrom, match.excerptFrom + match.to - match.from)}`
    )
  ]);

it('按目录顺序返回文稿和资料正文里的每一处命中，带行号、行内位置和附近的文字', () => {
  const volume = entry('第一卷', null);
  const second = entry('第二章', '沈霁推开门。\n\n屋里没有人，沈霁又退了出来。', 'manuscript', volume.id);
  const first = entry('第一章', `${'雪'.repeat(40)}沈霁守城。${'夜'.repeat(200)}`);
  // 第一章移到第一卷前面。
  value(
    app.executeAuthor({
      method: 'moveEntry',
      input: {
        commandId: randomUUID(),
        workId,
        entryId: first.id,
        expectedParentId: null,
        expectedPosition: first.position,
        parentId: null,
        beforeEntryId: volume.id
      }
    })
  );
  const resource = entry('沈霁', '# 沈霁\n军医。', 'resource');
  entry('目录里的沈霁', null, 'resource');

  const result = value(search('沈霁'));
  expect(found(result)).toEqual([
    [first.id, ['1:沈霁']],
    [second.id, ['1:沈霁', '3:沈霁']],
    [resource.id, ['1:沈霁']]
  ]);
  expect(result).toMatchObject({ total: 4, truncated: false, records: [], relations: [] });
  expect(result.entries[1]!.matches[1]).toEqual({
    line: 3,
    from: 6,
    to: 8,
    excerpt: '屋里没有人，沈霁又退了出来。',
    excerptFrom: 6
  });
  // 长行只带命中附近的文字。
  const [long] = result.entries[0]!.matches;
  expect(long).toMatchObject({ line: 1, from: 40, to: 42, excerptFrom: 16 });
  expect(long!.excerpt).toHaveLength(96);
  expect(long!.excerpt.startsWith(`${'雪'.repeat(16)}沈霁守城。`)).toBe(true);
});

it('区分大小写、全词匹配和正则各自生效，写错的正则报出原因', () => {
  entry('第一章', 'Lin met lin.\nLinda left; lin_2 stayed.\n沈霁、沈霁云和沈 霁。\n沈𠀀，沈。');
  const texts = (pattern: string, options: Partial<TextSearchInput> = {}) =>
    found(value(search(pattern, options))).flatMap(([, matches]) => matches);

  expect(texts('lin')).toEqual(['1:Lin', '1:lin', '2:Lin', '2:lin']);
  expect(texts('lin', { caseSensitive: true })).toEqual(['1:lin', '2:lin']);
  expect(texts('lin', { wholeWord: true })).toEqual(['1:Lin', '1:lin']);
  // 汉字连着写时算一个词，和文档内查找一样。
  expect(texts('沈霁', { wholeWord: true })).toEqual(['3:沈霁']);
  // 扩展区汉字占两个码元，也算词的一部分。
  expect(texts('沈', { wholeWord: true })).toEqual(['4:沈']);
  expect(texts('沈.霁', { regexp: true })).toEqual(['3:沈 霁']);
  expect(texts('沈.霁')).toEqual([]);
  expect(texts(String.raw`^L\w+`, { regexp: true, caseSensitive: true })).toEqual(['1:Lin', '2:Linda']);
  // 能匹配空串的正则不产生空命中，也不会卡住。
  expect(texts('x*', { regexp: true })).toEqual([]);
  // 命中不跨行。
  expect(texts(String.raw`lin\.\s+Linda`, { regexp: true })).toEqual([]);

  const invalid = search('(', { regexp: true });
  expect(invalid.ok).toBe(false);
  expect(!invalid.ok && invalid.error.message).toContain('正则表达式有误');
  expect(value(search('('))).toMatchObject({ total: 0 });
});

it('导入带 BOM 和混合换行的正文时，命中位置与编辑器显示的行列一致', () => {
  entry('来信', '\uFEFF梅花\r\n窗前\r梅枝');
  const result = value(search('梅'));
  expect(result.entries[0]?.matches.map(({ line, from, to }) => [line, from, to])).toEqual([
    [1, 0, 1],
    [3, 0, 1]
  ]);
});

it('有未保存输入的文稿按传入的当前文字搜，其余按已保存内容搜', () => {
  const edited = entry('第一章', '将军守城。');
  const saved = entry('第二章', '将军出城。');
  const result = value(
    search('将军', { unsaved: [{ documentId: edited.id, content: '城外下雪。\n斥候回营，将军未归。' }] })
  );
  expect(found(result)).toEqual([
    [edited.id, ['2:将军']],
    [saved.id, ['1:将军']]
  ]);
  expect(found(value(search('守城', { unsaved: [{ documentId: edited.id, content: '城外下雪。' }] })))).toEqual([]);
});

it('搜到事件的文字、关系的类型和两端称呼；回收站里的文稿和事件不搜', () => {
  const master = entry('沈霁', '军医。', 'resource');
  const student = entry('林婉', '学徒。', 'resource');
  const source = { kind: 'author' } as const;
  const placement = { kind: 'undetermined' } as const;
  const record = value(
    app.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [master.id],
        text: '沈霁收林婉为徒。\n师徒二人离开军营。',
        source,
        placement,
        storyTime: ''
      }
    })
  );
  const gone = value(
    app.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [master.id],
        text: '师徒反目。',
        source,
        placement,
        storyTime: ''
      }
    })
  );
  const relation = value(
    app.executeAuthor({
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [master.id, student.id],
        type: '师徒',
        directed: true,
        titles: ['师父', '徒弟'],
        milestones: [{ id: null, kind: 'start', source, placement, storyTime: '' }]
      }
    })
  );
  const trashed = entry('废稿', '师徒夜谈。');
  value(
    app.executeAuthor({
      method: 'removeRecord',
      input: { commandId: randomUUID(), workId, recordId: gone.id, expectedRevisionId: gone.revisionId }
    })
  );
  value(
    app.executeAuthor({ method: 'trashEntries', input: { commandId: randomUUID(), workId, entryIds: [trashed.id] } })
  );

  const result = value(search('师'));
  expect(result.entries).toEqual([]);
  expect(result.records).toEqual([
    { recordId: record.id, matches: [{ line: 2, from: 0, to: 1, excerpt: '师徒二人离开军营。', excerptFrom: 0 }] }
  ]);
  expect(result.relations).toEqual([
    {
      relationId: relation.id,
      matches: [
        { field: 'type', line: 1, from: 0, to: 1, excerpt: '师徒', excerptFrom: 0 },
        { field: 'firstTitle', line: 1, from: 0, to: 1, excerpt: '师父', excerptFrom: 0 }
      ]
    }
  ]);
  expect(result).toMatchObject({ total: 3, documentCount: 0, recordCount: 2 });
  expect(value(search('徒弟')).relations[0]!.matches).toMatchObject([{ field: 'secondTitle' }]);
});

it('命中超过上限时只返回前两千处，total 仍是全部命中数', () => {
  const first = entry('第一章', Array.from({ length: 1500 }, () => '雪落。').join('\n'));
  const second = entry('第二章', Array.from({ length: 1500 }, () => '雪停。').join('\n'));
  entry('第三章', '雪化了。');

  const result = value(search('雪'));
  expect(result).toMatchObject({ total: 3001, documentCount: 3, recordCount: 0, truncated: true });
  expect(result.entries.map(({ entryId, matches }) => [entryId, matches.length])).toEqual([
    [first.id, 1500],
    [second.id, 500]
  ]);
  expect(value(search('雪落'))).toMatchObject({ total: 1500, truncated: false });
});

it('整批替换保留划掉的命中、原换行与审阅中的正式文稿，每篇只保存一版', () => {
  const first = entry('第一章', '\uFEFF沈霁出城。\r\n沈霁到渡口。沈霁停步。');
  const other = entry('第二章', '沈霁回头。');
  value(
    app.executeAgent(
      { sessionId: '修改结局', mode: 'review' },
      {
        method: 'writeDocument',
        input: {
          commandId: randomUUID(),
          workId,
          documentId: other.id,
          expectedRevisionId: other.revisionId,
          title: other.title,
          format: 'txt',
          content: '他没有回头。'
        }
      }
    )
  );
  const pattern = '沈(霁)';
  // 预览给出的文字就是替换后写进正文的文字。
  expect(
    value(search(pattern, { regexp: true, replacement: '林$1' })).entries[0]!.matches.map(match => match.replacement)
  ).toEqual(['林霁', '林霁', '林霁']);
  const input = {
    commandId: randomUUID(),
    workId,
    pattern,
    caseSensitive: false,
    wholeWord: false,
    regexp: true,
    replacement: '林$1',
    targets: value(search(pattern, { regexp: true })).targets,
    excluded: [{ id: first.id, field: 'content' as const, line: 2, from: 0 }]
  };
  const run = () => value(app.executeAuthor({ method: 'replaceText', input }));
  const report = run();
  expect(report).toMatchObject({ count: 2, skipped: [other.id] });
  expect(run()).toEqual(report);
  const read = (documentId: string) =>
    value(app.executeAuthor({ method: 'readDocument', input: { workId, documentId } }));
  expect(read(first.id).content).toBe('\uFEFF林霁出城。\r\n沈霁到渡口。林霁停步。');
  expect(read(other.id).content).toBe('沈霁回头。');
  expect(value(app.executeAuthor({ method: 'listRevisions', input: { workId, documentId: first.id } }))).toHaveLength(
    2
  );
});

it('搜索后作者改过第二篇，整批替换回滚，第一篇仍是原修订', () => {
  const first = entry('第一章', '雨');
  const other = entry('第二章', '雨');
  const targets = value(search('雨')).targets;
  value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId: other.id,
        expectedRevisionId: other.revisionId,
        title: other.title,
        format: 'txt',
        content: '大雨'
      }
    })
  );
  expect(
    app.executeAuthor({
      method: 'replaceText',
      input: {
        commandId: randomUUID(),
        workId,
        pattern: '雨',
        regexp: false,
        caseSensitive: false,
        wholeWord: false,
        replacement: '雪',
        targets,
        excluded: []
      }
    })
  ).toMatchObject({ ok: false, error: { message: '搜索结果已变化，请重新搜索后替换' } });
  expect(value(app.executeAuthor({ method: 'readDocument', input: { workId, documentId: first.id } }))).toMatchObject({
    content: '雨',
    revisionId: first.revisionId
  });
});

it('同批替换正文、事件和关系称呼，只顺延原已核对的出处', () => {
  const chapter = entry('初遇', '先生');
  const master = entry('先生', '', 'resource');
  const apprentice = entry('学徒', '', 'resource');
  const placement = { kind: 'opening' } as const;
  const record = (text: string, revisionId: string) =>
    value(
      app.executeAuthor({
        method: 'createRecord',
        input: {
          commandId: randomUUID(),
          workId,
          resourceIds: [master.id],
          text,
          source: { kind: 'chapter', chapterId: chapter.id, revisionId },
          placement,
          storyTime: ''
        }
      })
    );
  const stale = record('旧事', chapter.revisionId);
  const current = value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId: chapter.id,
        expectedRevisionId: chapter.revisionId,
        title: chapter.title,
        format: 'txt',
        content: '先生收徒。'
      }
    })
  );
  record('先生出门。', current.revisionId);
  value(
    app.executeAuthor({
      method: 'createRelation',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [master.id, apprentice.id],
        type: '师徒',
        directed: true,
        titles: ['先生', '徒弟'],
        milestones: [
          {
            id: null,
            kind: 'start',
            source: { kind: 'chapter', chapterId: chapter.id, revisionId: current.revisionId },
            placement,
            storyTime: ''
          }
        ]
      }
    })
  );
  const report = value(
    app.executeAuthor({
      method: 'replaceText',
      input: {
        commandId: randomUUID(),
        workId,
        pattern: '先生',
        regexp: false,
        caseSensitive: false,
        wholeWord: false,
        replacement: '师傅',
        targets: value(search('先生')).targets,
        excluded: []
      }
    })
  );
  expect(report.count).toBe(3);
  expect(value(search('师傅'))).toMatchObject({ total: 3, recordCount: 2, documentCount: 1 });
  expect(value(app.executeAuthor({ method: 'listSourceReviews', input: { workId } }))).toMatchObject([
    { chapterId: chapter.id, recordIds: [stale.id], milestoneIds: [] }
  ]);
  expect(value(app.executeAuthor({ method: 'readDocument', input: { workId, documentId: master.id } })).title).toBe(
    '先生'
  );
});

it('事件有待接受修改时，替换不动它的文字和出处', () => {
  const chapter = entry('初遇', '先生收徒。');
  const master = entry('先生', '', 'resource');
  const fields = {
    resourceIds: [master.id],
    text: '先生出门。',
    source: { kind: 'chapter' as const, chapterId: chapter.id, revisionId: chapter.revisionId },
    placement: { kind: 'opening' as const },
    storyTime: ''
  };
  const record = value(
    app.executeAuthor({ method: 'createRecord', input: { commandId: randomUUID(), workId, ...fields } })
  );
  value(
    app.executeAgent(
      { sessionId: '改事件', mode: 'review' },
      {
        method: 'updateRecord',
        input: {
          commandId: randomUUID(),
          workId,
          recordId: record.id,
          expectedRevisionId: record.revisionId,
          ...fields,
          text: '先生远行。',
          basis: '远行'
        }
      }
    )
  );
  const report = value(
    app.executeAuthor({
      method: 'replaceText',
      input: {
        commandId: randomUUID(),
        workId,
        pattern: '先生',
        regexp: false,
        caseSensitive: false,
        wholeWord: false,
        replacement: '师傅',
        targets: value(search('先生')).targets,
        excluded: []
      }
    })
  );
  expect(report).toMatchObject({ count: 1, skipped: [record.id] });
  expect(value(app.executeAuthor({ method: 'snapshot', input: { workId } }))).toMatchObject({
    records: [{ id: record.id, text: '先生出门。', revisionId: record.revisionId }]
  });
});

it('撤销替换还原正文、事件和核对状态，替换后作者又改过的文稿保持新内容并列出', () => {
  const first = entry('第一章', '先生到。');
  const second = entry('第二章', '先生走。');
  const master = entry('先生', '', 'resource');
  const record = value(
    app.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [master.id],
        text: '先生出门。',
        source: { kind: 'chapter', chapterId: first.id, revisionId: first.revisionId },
        placement: { kind: 'opening' },
        storyTime: ''
      }
    })
  );
  const replaced = value(
    app.executeAuthor({
      method: 'replaceText',
      input: {
        commandId: randomUUID(),
        workId,
        pattern: '先生',
        regexp: false,
        caseSensitive: false,
        wholeWord: false,
        replacement: '师傅',
        targets: value(search('先生')).targets,
        excluded: []
      }
    })
  );
  const read = (documentId: string) =>
    value(app.executeAuthor({ method: 'readDocument', input: { workId, documentId } }));
  value(
    app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId: second.id,
        expectedRevisionId: read(second.id).revisionId,
        title: second.title,
        format: 'txt',
        content: '师傅走了。'
      }
    })
  );

  const undone = value(
    app.executeAuthor({
      method: 'undoReplaceText',
      input: { commandId: randomUUID(), workId, revisions: replaced.revisions }
    })
  );
  expect(undone).toEqual({ count: 2, skipped: [second.id] });
  expect(read(first.id).content).toBe('先生到。');
  expect(read(second.id).content).toBe('师傅走了。');
  expect(value(app.executeAuthor({ method: 'snapshot', input: { workId } }))).toMatchObject({
    records: [{ id: record.id, text: '先生出门。' }]
  });
  expect(value(app.executeAuthor({ method: 'listSourceReviews', input: { workId } }))).toEqual([]);
});
