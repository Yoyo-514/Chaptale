import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { copyFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CreationService } from '@chaptale/creation';
import type { CreationEvent } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

describe('作品提交事件与快照', () => {
  let rootDir: string;
  let service: CreationService;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'chaptale-events-'));
    service = new CreationService(await openCreationStorage({ rootDir }));
  });

  afterEach(async () => {
    service.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('各作品游标独立，事件分页续接且快照和事件不携带正文或草稿', () => {
    const work = service.createWork({ commandId: randomUUID(), title: '甲作品', kind: 'novel' });
    const empty = service.snapshot(work.id);
    const first = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'manuscript',
      kind: 'document',
      title: '甲',
      format: 'txt',
      content: '正文私有片段'
    });
    const middle = service.snapshot(work.id);
    const second = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'resource',
      kind: 'directory',
      title: '资料'
    });
    const end = service.snapshot(work.id);
    service.writeDraft({
      draftId: randomUUID(),
      expectedDraftVersion: null,
      workId: work.id,
      documentId: first.id,
      expectedRevisionId: first.revisionId,
      title: first.title,
      format: 'txt',
      content: '草稿私有片段'
    });
    expect(service.snapshot(work.id)).toEqual(end);
    expect(end).toEqual({ kind: 'work', workId: work.id, cursor: end.cursor, entries: [first, second] });
    const page = service.readChanges(empty.cursor, 1);
    expect(page).toEqual({
      kind: 'changes',
      cursor: middle.cursor,
      hasMore: true,
      events: [expect.objectContaining({ change: { kind: 'entry', entry: first } })]
    });
    expect(service.readChanges(middle.cursor, 1)).toEqual({
      kind: 'changes',
      cursor: end.cursor,
      hasMore: false,
      events: [expect.objectContaining({ change: { kind: 'entry', entry: second } })]
    });
    expect(JSON.stringify([end, page])).not.toContain('正文私有片段');
    expect(JSON.stringify([end, page])).not.toContain('草稿私有片段');
    const other = service.createWork({ commandId: randomUUID(), title: '乙作品', kind: 'script' });
    service.createEntry({
      commandId: randomUUID(),
      workId: other.id,
      parentId: null,
      section: 'manuscript',
      kind: 'directory',
      title: '第一幕'
    });
    expect(service.readChanges({ ...middle.cursor, workId: other.id }, 1)).toEqual({ kind: 'snapshot-required' });
    expect(service.snapshot(work.id)).toEqual(end);
  });

  it('快照之后的改名和移动可补发，实时通知和历史使用同一提交身份', async () => {
    const work = service.createWork({ commandId: randomUUID(), title: '长夜行', kind: 'novel' });
    const folder = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'manuscript',
      kind: 'directory',
      title: '第一卷'
    });
    const document = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'manuscript',
      kind: 'document',
      title: '序章',
      format: 'txt',
      content: '正文'
    });
    const before = service.snapshot(work.id);
    const renamed = service.renameDirectory({
      commandId: randomUUID(),
      workId: work.id,
      directoryId: folder.id,
      expectedRevisionId: folder.revisionId,
      title: '风起'
    });
    const renamedCursor = service.snapshot(work.id).cursor;
    const events: CreationEvent[] = [];
    service.subscribe(event => events.push(event));
    const moved = service.moveEntry({
      commandId: randomUUID(),
      workId: work.id,
      entryId: document.id,
      expectedParentId: document.parentId,
      expectedPosition: document.position,
      parentId: folder.id,
      beforeEntryId: null
    });
    await Promise.resolve();
    expect(events).toEqual([
      expect.objectContaining({
        change: {
          kind: 'move',
          entry: moved,
          from: { parentId: null, position: document.position }
        }
      })
    ]);
    expect(service.readChanges(before.cursor, 2)).toEqual({
      kind: 'changes',
      hasMore: false,
      cursor: service.snapshot(work.id).cursor,
      events: [expect.objectContaining({ cursor: renamedCursor, change: { kind: 'entry', entry: renamed } }), events[0]]
    });
  });

  it('恢复旧库后即使复用同一命令和序号，旧提交游标也要求重取快照', async () => {
    service.createWork({ commandId: randomUUID(), title: '共同起点', kind: 'novel' });
    const common = service.snapshot(null).cursor;
    service.close();
    const file = join(rootDir, 'library.sqlite');
    const backup = join(rootDir, 'before.sqlite');
    await copyFile(file, backup);
    service = new CreationService(await openCreationStorage({ rootDir }));
    const command = { commandId: randomUUID(), title: '第二部', kind: 'novel' as const };
    service.createWork(command);
    const old = service.snapshot(null).cursor;
    service.close();
    await copyFile(backup, file);
    service = new CreationService(await openCreationStorage({ rootDir }));
    const restoredWork = service.createWork(command);
    const current = service.snapshot(null).cursor;
    expect(current.sequence).toBe(old.sequence);
    expect(current.token).not.toBe(old.token);
    expect(service.readChanges(old, 2)).toEqual({ kind: 'snapshot-required' });
    expect(service.readChanges(common, 2)).toEqual({
      kind: 'changes',
      cursor: current,
      hasMore: false,
      events: [expect.objectContaining({ change: { kind: 'work', work: restoredWork } })]
    });
  });

  it('监听器重入写入仍按提交顺序投递，各监听器和调用者的修改彼此隔离', async () => {
    const events: CreationEvent[] = [];
    service.subscribe(event => {
      if (event.change.kind === 'work' && event.change.work.title === '甲') {
        service.createWork({ commandId: randomUUID(), title: '乙', kind: 'novel' });
        event.change.work.title = '监听器修改';
        event.cursor.sequence = -1;
      }
    });
    service.subscribe(event => events.push(event));
    const work = service.createWork({ commandId: randomUUID(), title: '甲', kind: 'novel' });
    work.title = '调用者修改';
    await Promise.resolve();
    await Promise.resolve();
    expect(events.map(event => event.cursor.sequence)).toEqual([1, 2]);
    expect(events.map(event => event.change)).toEqual([
      { kind: 'work', work: expect.objectContaining({ title: '甲' }) },
      { kind: 'work', work: expect.objectContaining({ title: '乙' }) }
    ]);
    service.createWork({ commandId: randomUUID(), title: '关闭前排队', kind: 'novel' });
    service.close();
    await Promise.resolve();
    expect(events).toHaveLength(2);
  });

  it.each([0, -1, 1.5, NaN])('拒绝非法分页数量 %s', limit => {
    const snapshot = service.snapshot(null);
    expect(() => service.readChanges(snapshot.cursor, limit)).toThrow('事件分页数量必须是正整数');
  });

  it('COMMIT 失败后不推进游标或发布成功事件，重试成功只发布一次', async () => {
    const work = service.createWork({ commandId: randomUUID(), title: '长夜行', kind: 'novel' });
    const entry = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'manuscript',
      kind: 'document',
      title: '雨夜',
      format: 'txt',
      content: '原稿'
    });
    const before = service.snapshot(work.id);
    const events: CreationEvent[] = [];
    service.subscribe(event => events.push(event));
    const fault = new Database(join(rootDir, 'works', `${work.id}.sqlite`));
    const command = {
      commandId: randomUUID(),
      workId: work.id,
      documentId: entry.id,
      expectedRevisionId: entry.revisionId,
      title: '破晓',
      format: 'txt' as const,
      content: '新稿'
    };
    try {
      fault.exec(`CREATE TABLE commit_failure (
        entryId TEXT REFERENCES entries(id) DEFERRABLE INITIALLY DEFERRED
      ) STRICT;
      CREATE TRIGGER fail_commit AFTER INSERT ON command_receipts BEGIN
        INSERT INTO commit_failure (entryId) VALUES ('故障注入：不存在的条目');
      END;`);
      expect(() => service.saveDocument(command)).toThrowError(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
      );
      await Promise.resolve();
      expect(events).toEqual([]);
      expect(service.snapshot(work.id)).toEqual(before);
      expect(service.readChanges(before.cursor, 2)).toEqual({
        kind: 'changes',
        cursor: before.cursor,
        events: [],
        hasMore: false
      });
      fault.exec('DROP TRIGGER fail_commit; DROP TABLE commit_failure;');
      const saved = service.saveDocument(command);
      await Promise.resolve();
      expect(events).toEqual([
        expect.objectContaining({ commandId: command.commandId, change: { kind: 'entry', entry: saved } })
      ]);
      expect(service.saveDocument(command)).toEqual(saved);
      await Promise.resolve();
      expect(events).toHaveLength(1);
    } finally {
      fault.close();
    }
  });

  it('取消订阅后同一回调重新订阅，只接收新订阅之后的提交', async () => {
    const events: CreationEvent[] = [];
    const listener = (event: CreationEvent) => events.push(event);
    const stop = service.subscribe(listener);
    service.createWork({ commandId: randomUUID(), title: '旧订阅期间', kind: 'novel' });
    stop();
    const stopNew = service.subscribe(listener);
    await Promise.resolve();
    expect(events).toEqual([]);
    const work = service.createWork({ commandId: randomUUID(), title: '新订阅期间', kind: 'script' });
    await Promise.resolve();
    expect(events).toEqual([expect.objectContaining({ change: { kind: 'work', work } })]);
    stopNew();
    service.createWork({ commandId: randomUUID(), title: '已取消', kind: 'novel' });
    await Promise.resolve();
    expect(events).toHaveLength(1);
  });

  it('作品创建提交后可读快照，重试旧命令不重复发布且历史可从游标续接', async () => {
    const empty = service.snapshot(null);
    expect(empty).toEqual({ kind: 'library', works: [], cursor: { workId: null, sequence: 0, token: null } });
    const events: CreationEvent[] = [];
    const unsubscribe = service.subscribe(event => {
      events.push(event);
      expect(service.listWorks()).toHaveLength(1);
    });
    const command = { commandId: randomUUID(), title: '长夜行', kind: 'novel' as const };
    const work = service.createWork(command);
    const snapshot = service.snapshot(null);
    expect(snapshot).toMatchObject({ kind: 'library', works: [work] });
    await Promise.resolve();
    expect(events).toEqual([
      expect.objectContaining({
        commandId: command.commandId,
        cursor: snapshot.cursor,
        change: { kind: 'work', work }
      })
    ]);
    expect(service.createWork(command)).toEqual(work);
    await Promise.resolve();
    expect(events).toHaveLength(1);
    const changes = service.readChanges(empty.cursor, 1);
    expect(changes).toEqual({ kind: 'changes', cursor: snapshot.cursor, events, hasMore: false });
    unsubscribe();
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));
    expect(service.snapshot(null)).toEqual(snapshot);
    expect(service.readChanges(empty.cursor, 1)).toEqual(changes);
    expect(service.readChanges(snapshot.cursor, 1)).toEqual({
      kind: 'changes',
      cursor: snapshot.cursor,
      events: [],
      hasMore: false
    });
  });
});
