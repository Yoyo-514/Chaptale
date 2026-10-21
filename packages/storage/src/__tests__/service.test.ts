import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CreationService } from '@chaptale/creation';

import { openCreationStorage } from '../index.ts';

describe('作品服务', () => {
  let rootDir: string;
  let service: CreationService;

  beforeEach(async () => {
    rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-creation-'));
    service = new CreationService(await openCreationStorage({ rootDir }));
  });

  afterEach(async () => {
    service?.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  it('关闭并重开后保留作品身份、名称和类型', async () => {
    const work = service.createWork({ commandId: randomUUID(), title: '长夜行', kind: 'novel' });
    expect(work.title).toBe('长夜行');
    expect(work.kind).toBe('novel');

    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(service.listWorks()).toEqual([expect.objectContaining({ id: work.id, title: '长夜行', kind: 'novel' })]);
  });

  it('重启后重试相同创建命令返回原回执，作品只创建一次', async () => {
    const command = { commandId: randomUUID(), title: '雨停之前', kind: 'script' as const };
    const first = service.createWork(command);
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(service.createWork(command)).toEqual(first);
    expect(service.listWorks()).toHaveLength(1);
  });

  it('拒绝用同一命令身份提交不同内容', () => {
    const command = { commandId: randomUUID(), title: '长夜行', kind: 'novel' as const };
    service.createWork(command);

    expect(() => service.createWork({ ...command, title: '另一部作品' })).toThrow('同一命令不能用于不同操作或参数');
    expect(service.listWorks()).toEqual([expect.objectContaining({ title: '长夜行' })]);
  });

  function createDocument(content: string) {
    const work = service.createWork({ commandId: randomUUID(), title: '长夜行', kind: 'novel' });
    const document = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'manuscript',
      kind: 'document',
      title: '雨夜',
      format: 'txt',
      content
    });
    return { work, document };
  }

  it('保存同时更新标题、格式与原文，旧修订仍可读取', async () => {
    const { work, document } = createDocument('雨未停。');
    const saved = service.saveDocument({
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '破晓',
      format: 'markdown',
      content: '天亮了。\r\n\r\n雨停了。'
    });
    expect(saved.revisionId).not.toBe(document.revisionId);
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(service.readDocument(work.id, document.id)).toMatchObject({
      title: '破晓',
      format: 'markdown',
      content: '天亮了。\r\n\r\n雨停了。',
      wordCount: 6,
      revisionId: saved.revisionId
    });
    expect(service.readRevision(work.id, document.revisionId)).toMatchObject({
      parentRevisionId: null,
      source: 'author',
      snapshot: { title: '雨夜', content: '雨未停。' }
    });
    expect(service.readRevision(work.id, saved.revisionId)).toMatchObject({
      parentRevisionId: document.revisionId,
      source: 'author',
      snapshot: { title: '破晓', content: '天亮了。\r\n\r\n雨停了。' }
    });
  });

  it('过期修订拒绝覆盖已提交的新版本', () => {
    const { work, document } = createDocument('旧稿。');
    const input = {
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '先保存的新稿。'
    };
    const saved = service.saveDocument(input);

    expect(() => service.saveDocument({ ...input, commandId: randomUUID(), content: '迟到的旧稿修改。' })).toThrowError(
      expect.objectContaining({ code: 'revision-conflict', actualRevisionId: saved.revisionId })
    );
    expect(service.readDocument(work.id, document.id)).toMatchObject({
      content: '先保存的新稿。',
      revisionId: saved.revisionId
    });
  });

  it('连续保存相同状态不改变修订和保存时间', () => {
    const { work, document } = createDocument('原稿。');
    const input = {
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '原稿。'
    };
    expect(service.saveDocument(input)).toEqual(document);
    expect(service.saveDocument({ ...input, commandId: randomUUID() })).toEqual(document);
    expect(service.readRevision(work.id, document.revisionId).parentRevisionId).toBeNull();
  });

  it('保存回执在重启和后续编辑后仍返回原结果，不重复覆盖', async () => {
    const { work, document } = createDocument('旧稿。');
    const command = {
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '第一稿。'
    };
    const first = service.saveDocument(command);
    const latest = service.saveDocument({
      ...command,
      commandId: randomUUID(),
      expectedRevisionId: first.revisionId,
      content: '第二稿。'
    });
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(service.saveDocument(command)).toEqual(first);
    expect(service.readDocument(work.id, document.id)).toMatchObject({
      content: '第二稿。',
      revisionId: latest.revisionId
    });
  });

  it('恢复草稿跨重启保留输入，正式文稿和修订保持原样', async () => {
    const { work, document } = createDocument('已保存原稿。');
    expect(service.readDraftState(work.id, document.id)).toEqual({ version: null, draft: null });
    const state = service.writeDraft({
      draftId: randomUUID(),
      expectedDraftVersion: null,
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '未完成',
      format: 'txt',
      content: '输入中的草稿。\r\n'
    });
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(service.readDraftState(work.id, document.id)).toEqual(state);
    expect(state.draft).toMatchObject({
      title: '未完成',
      content: '输入中的草稿。\r\n',
      expectedRevisionId: document.revisionId
    });
    expect(service.readDocument(work.id, document.id)).toMatchObject({
      content: '已保存原稿。',
      revisionId: document.revisionId
    });
  });

  it('迟到的草稿写入不能覆盖较新的输入', () => {
    const { work, document } = createDocument('原稿。');
    const input = {
      draftId: randomUUID(),
      expectedDraftVersion: null,
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '第一次输入。'
    };
    const first = service.writeDraft(input);
    const second = service.writeDraft({
      ...input,
      draftId: randomUUID(),
      expectedDraftVersion: first.version,
      content: '较新的输入。'
    });

    expect(() =>
      service.writeDraft({
        ...input,
        draftId: randomUUID(),
        expectedDraftVersion: first.version,
        content: '迟到的输入。'
      })
    ).toThrowError(expect.objectContaining({ code: 'draft-conflict', actualVersion: second.version }));
    expect(service.readDraftState(work.id, document.id)).toEqual(second);
  });

  it('重试同一草稿快照返回原状态，复用身份改内容会被拒绝', () => {
    const { work, document } = createDocument('原稿。');
    const input = {
      draftId: randomUUID(),
      expectedDraftVersion: null,
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '草稿。'
    };
    const state = service.writeDraft(input);
    expect(service.writeDraft(input)).toEqual(state);
    expect(() => service.writeDraft({ ...input, content: '另一份内容。' })).toThrow('同一草稿身份不能用于不同内容');
    expect(service.readDraftState(work.id, document.id)).toEqual(state);
  });

  it.each(['草稿。', '原稿。'])('正式保存 %j 后清除对应草稿，迟到写入不能复活它', content => {
    const { work, document } = createDocument('原稿。');
    const input = {
      draftId: randomUUID(),
      expectedDraftVersion: null,
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content
    };
    service.writeDraft(input);
    service.saveDocument({
      commandId: input.draftId,
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt',
      content
    });

    expect(service.readDraftState(work.id, document.id)).toEqual({ version: input.draftId, draft: null });
    expect(() => service.writeDraft(input)).toThrowError(expect.objectContaining({ code: 'draft-conflict' }));
    expect(service.readDocument(work.id, document.id).content).toBe(content);
  });

  it('旧保存请求重试后仍保留较新草稿及其版本', async () => {
    const { work, document } = createDocument('原稿。');
    const command = {
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '第一稿。'
    };
    service.writeDraft({ ...command, draftId: command.commandId, expectedDraftVersion: null });
    const saved = service.saveDocument(command);
    const latest = service.writeDraft({
      ...command,
      draftId: randomUUID(),
      expectedDraftVersion: command.commandId,
      expectedRevisionId: saved.revisionId,
      content: '仍在输入的新草稿。'
    });
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(service.saveDocument(command)).toEqual(saved);
    expect(service.readDraftState(work.id, document.id)).toEqual(latest);
    expect(service.readDocument(work.id, document.id)).toMatchObject({
      content: '第一稿。',
      revisionId: saved.revisionId
    });
  });

  it('正式事务在提交时失败，重开保留原稿和草稿，同命令可重新保存', async () => {
    const { work, document } = createDocument('原稿。');
    const original = service.readDocument(work.id, document.id);
    const command = {
      commandId: randomUUID(),
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '破晓',
      format: 'txt' as const,
      content: '待保存的新稿。'
    };
    const draft = service.writeDraft({ ...command, draftId: command.commandId, expectedDraftVersion: null });
    const fault = new Database(path.join(rootDir, 'works', `${work.id}.sqlite`));
    try {
      // 延迟外键在 COMMIT 时失败，让正文、修订和回执先执行写入，再验证整体回滚。
      fault.exec(`
        CREATE TABLE commit_failure (
          entryId TEXT REFERENCES entries(id) DEFERRABLE INITIALLY DEFERRED
        ) STRICT;
        CREATE TRIGGER fail_commit AFTER INSERT ON command_receipts BEGIN
          INSERT INTO commit_failure (entryId) VALUES ('故障注入：不存在的条目');
        END;
      `);
      expect(() => service.saveDocument(command)).toThrowError(
        expect.objectContaining({ code: 'SQLITE_CONSTRAINT_FOREIGNKEY' })
      );
      service.close();
      service = new CreationService(await openCreationStorage({ rootDir }));
      expect(service.readDocument(work.id, document.id)).toEqual(original);
      expect(service.readRevision(work.id, document.revisionId).snapshot).toEqual(original);
      expect(service.readDraftState(work.id, document.id)).toEqual(draft);

      fault.exec('DROP TRIGGER fail_commit; DROP TABLE commit_failure;');
      const saved = service.saveDocument(command);
      expect(saved.revisionId).not.toBe(document.revisionId);
      expect(service.readDocument(work.id, document.id)).toMatchObject({
        title: '破晓',
        content: '待保存的新稿。',
        revisionId: saved.revisionId
      });
      expect(service.readRevision(work.id, saved.revisionId).parentRevisionId).toBe(document.revisionId);
      expect(service.readDraftState(work.id, document.id)).toEqual({ version: command.commandId, draft: null });
      expect(service.saveDocument(command)).toEqual(saved);
    } finally {
      fault.close();
    }
  });

  it('正式提交后本机库写入失败仍发布提交，重开按回执清理草稿', async () => {
    const events: unknown[] = [];
    const { work, document } = createDocument('原稿。');
    service.subscribe(event => events.push(event));
    const draftId = randomUUID();
    const input = {
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '已提交的新稿。'
    };
    service.writeDraft({ ...input, draftId, expectedDraftVersion: null });
    // 用第二个真实连接占用本机库写锁，作品库仍能完成正式事务。
    const lock = new Database(path.join(rootDir, 'library.sqlite'));
    try {
      lock.exec('BEGIN IMMEDIATE');
      expect(() => service.saveDocument({ ...input, commandId: draftId })).toThrow(
        expect.objectContaining({ code: 'SQLITE_BUSY' })
      );
    } finally {
      lock.close();
    }
    await Promise.resolve();
    expect(events).toEqual([
      expect.objectContaining({
        commandId: draftId,
        change: { kind: 'entry', entry: expect.objectContaining({ id: document.id }) }
      })
    ]);
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    const saved = service.readDocument(work.id, document.id);
    expect(saved.content).toBe('已提交的新稿。');
    expect(service.readDraftState(work.id, document.id)).toEqual({ version: draftId, draft: null });
    expect(service.saveDocument({ ...input, commandId: draftId }).revisionId).toBe(saved.revisionId);
  }, 15_000);

  it('丢弃草稿保留版本标记，旧请求不能复活或清除较新输入', async () => {
    const { work, document } = createDocument('原稿。');
    const input = {
      draftId: randomUUID(),
      expectedDraftVersion: null,
      workId: work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      title: '雨夜',
      format: 'txt' as const,
      content: '准备丢弃。'
    };
    service.writeDraft(input);
    expect(service.discardDraft(work.id, document.id, input.draftId)).toEqual({ version: input.draftId, draft: null });
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));
    expect(() => service.writeDraft(input)).toThrowError(expect.objectContaining({ code: 'draft-conflict' }));
    const latest = service.writeDraft({
      ...input,
      draftId: randomUUID(),
      expectedDraftVersion: input.draftId,
      content: '保留的新输入。'
    });
    expect(() => service.discardDraft(work.id, document.id, input.draftId)).toThrowError(
      expect.objectContaining({ code: 'draft-conflict', actualVersion: latest.version })
    );
    expect(service.readDraftState(work.id, document.id)).toEqual(latest);
  });

  it('目录改名后重开保留身份、子项和历史名称', async () => {
    const work = service.createWork({ commandId: randomUUID(), title: '长夜行', kind: 'novel' });
    const folder = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'manuscript',
      kind: 'directory',
      title: '第一卷'
    });
    const child = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: folder.id,
      section: 'manuscript',
      kind: 'document',
      title: '雨夜',
      format: 'txt',
      content: '原文。'
    });
    const command = {
      commandId: randomUUID(),
      workId: work.id,
      directoryId: folder.id,
      expectedRevisionId: folder.revisionId,
      title: '风起'
    };
    const renamed = service.renameDirectory(command);
    expect(renamed).toMatchObject({ id: folder.id, title: '风起', parentId: null, position: folder.position });
    expect(renamed.revisionId).not.toBe(folder.revisionId);
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));
    expect(service.listEntries(work.id)).toEqual(expect.arrayContaining([renamed, child]));
    expect(service.readRevision(work.id, folder.revisionId).snapshot.title).toBe('第一卷');
    expect(service.readRevision(work.id, renamed.revisionId)).toMatchObject({
      parentRevisionId: folder.revisionId,
      snapshot: { title: '风起', content: null }
    });
    expect(service.renameDirectory(command)).toEqual(renamed);
  });

  it('目录同名保存保持修订，拒绝过期改名、命令复用和把文稿当目录', () => {
    const { work, document } = createDocument('原文。');
    const folder = service.createEntry({
      commandId: randomUUID(),
      workId: work.id,
      parentId: null,
      section: 'resource',
      kind: 'directory',
      title: '人物'
    });
    const command = {
      commandId: randomUUID(),
      workId: work.id,
      directoryId: folder.id,
      expectedRevisionId: folder.revisionId,
      title: folder.title
    };
    expect(service.renameDirectory(command)).toEqual(folder);
    expect(() => service.renameDirectory({ ...command, title: '角色' })).toThrow('同一命令不能用于不同操作或参数');
    const saved = service.renameDirectory({ ...command, commandId: randomUUID(), title: '角色' });
    expect(() => service.renameDirectory({ ...command, commandId: randomUUID(), title: '迟到改名' })).toThrowError(
      expect.objectContaining({ code: 'revision-conflict', actualRevisionId: saved.revisionId })
    );
    expect(() => service.renameDirectory({ ...command, commandId: randomUUID(), directoryId: document.id })).toThrow(
      '目录不存在'
    );
    expect(service.renameDirectory(command)).toEqual(folder);
    expect(service.listEntries(work.id)).toEqual(expect.arrayContaining([saved, document]));
    expect(service.readDocument(work.id, document.id).content).toBe('原文。');
  });

  it('文稿目录和原文重开后保持层级、身份及保存字数', async () => {
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
      parentId: folder.id,
      section: 'manuscript',
      kind: 'document',
      title: '雨夜',
      format: 'txt',
      content: '雨夜。\r\n\r\n来客。'
    });
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(service.listEntries(work.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: folder.id, kind: 'directory', parentId: null }),
        expect.objectContaining({ id: document.id, title: '雨夜', parentId: folder.id, wordCount: 4 })
      ])
    );
    expect(service.readDocument(work.id, document.id)).toMatchObject({
      id: document.id,
      title: '雨夜',
      content: '雨夜。\r\n\r\n来客。',
      format: 'txt',
      revisionId: expect.any(String)
    });
  });
});
