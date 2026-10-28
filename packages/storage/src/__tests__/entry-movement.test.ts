import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { CreationService } from '@chaptale/creation';
import type { Entry } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

describe('作品目录移动', () => {
  let rootDir: string;
  let service: CreationService;
  let workId: string;

  beforeEach(async () => {
    rootDir = await mkdtemp(join(tmpdir(), 'chaptale-movement-'));
    service = new CreationService(await openCreationStorage({ rootDir }));
    workId = service.createWork({ commandId: randomUUID(), title: '长夜行', kind: 'novel' }).id;
  });

  afterEach(async () => {
    service.close();
    await rm(rootDir, { recursive: true, force: true });
  });

  function entry(title: string, kind: Entry['kind'], parentId: string | null = null) {
    const base = { commandId: randomUUID(), workId, parentId, section: 'manuscript' as const, title };
    return service.createEntry(
      kind === 'directory'
        ? { ...base, kind }
        : {
            ...base,
            kind,
            format: 'txt',
            content: `${title}的正文。`
          }
    );
  }

  it.each([
    { from: 0, before: null, order: [1, 2, 0] },
    { from: 2, before: 0, order: [2, 0, 1] },
    { from: 0, before: 2, order: [1, 0, 2] },
    { from: 1, before: 1, order: [0, 1, 2] },
    { from: 0, before: 1, order: [0, 1, 2] },
    { from: 2, before: null, order: [0, 1, 2] }
  ])('同级排序 from=$from before=$before，移动到自身或相邻原位置保持原序', ({ from, before, order }) => {
    const documents = ['甲', '乙', '丙'].map(title => entry(title, 'document'));
    const source = documents[from];
    service.moveEntry({
      commandId: randomUUID(),
      workId,
      entryId: source.id,
      expectedParentId: source.parentId,
      expectedPosition: source.position,
      parentId: null,
      beforeEntryId: before === null ? null : documents[before].id
    });
    const saved = service.listEntries(workId);
    expect(saved.map(item => item.id)).toEqual(order.map(index => documents[index].id));
    expect(saved.map(item => item.position)).toEqual([0, 1, 2]);
    expect(saved.map(item => item.revisionId)).toEqual(order.map(index => documents[index].revisionId));
  });

  it('移动目录连同内部层级，随后移回根目录仍沿用全部身份', () => {
    const source = entry('第一卷', 'directory');
    const child = entry('分卷', 'directory', source.id);
    const document = entry('正文', 'document', child.id);
    const target = entry('合集', 'directory');
    const original = service.readDocument(workId, document.id);
    const moved = service.moveEntry({
      commandId: randomUUID(),
      workId,
      entryId: source.id,
      expectedParentId: source.parentId,
      expectedPosition: source.position,
      parentId: target.id,
      beforeEntryId: null
    });
    expect(service.listEntries(workId)).toEqual(expect.arrayContaining([child, document, moved]));
    const returned = service.moveEntry({
      commandId: randomUUID(),
      workId,
      entryId: source.id,
      expectedParentId: moved.parentId,
      expectedPosition: moved.position,
      parentId: null,
      beforeEntryId: target.id
    });
    expect(returned).toEqual(source);
    expect(service.readDocument(workId, document.id)).toEqual(original);
  });

  it.each(['source', 'parent', 'document', 'work', 'section', 'anchor', 'anchor-parent', 'anchor-section'])(
    '拒绝无效目标 %s，保持所有条目',
    invalid => {
      const source = entry('序章', 'document');
      const folder = entry('第一卷', 'directory');
      const nested = entry('卷内正文', 'document', folder.id);
      const resource = service.createEntry({
        commandId: randomUUID(),
        workId,
        parentId: null,
        section: 'resource',
        kind: 'directory',
        title: '人物'
      });
      const otherWork = service.createWork({ commandId: randomUUID(), title: '另一作品', kind: 'script' });
      const foreign = service.createEntry({
        commandId: randomUUID(),
        workId: otherWork.id,
        parentId: null,
        section: 'manuscript',
        kind: 'directory',
        title: '外部目录'
      });
      const parents: Record<string, string> = {
        parent: randomUUID(),
        document: source.id,
        work: foreign.id,
        section: resource.id
      };
      const anchors: Record<string, string> = {
        anchor: randomUUID(),
        'anchor-parent': nested.id,
        'anchor-section': resource.id
      };
      const original = service.listEntries(workId);
      expect(() =>
        service.moveEntry({
          commandId: randomUUID(),
          workId,
          entryId: invalid === 'source' ? randomUUID() : source.id,
          expectedParentId: source.parentId,
          expectedPosition: source.position,
          parentId: parents[invalid] ?? null,
          beforeEntryId: anchors[invalid] ?? null
        })
      ).toThrow(
        invalid === 'source'
          ? '条目不存在'
          : invalid.startsWith('anchor')
            ? '排序目标不存在或不属于目标目录'
            : '目标目录不存在或不属于当前内容区域'
      );
      expect(service.listEntries(workId)).toEqual(original);
      expect(service.listEntries(otherWork.id)).toEqual([foreign]);
    }
  );

  it.each([0, 1, 2])('目录不能移到自身或第 %i 层子目录，失败保持原树', depth => {
    const source = entry('第一卷', 'directory');
    const child = entry('中卷', 'directory', source.id);
    const descendant = entry('下卷', 'directory', child.id);
    entry('尾声', 'document');
    const original = service.listEntries(workId);
    expect(() =>
      service.moveEntry({
        commandId: randomUUID(),
        workId,
        entryId: source.id,
        expectedParentId: source.parentId,
        expectedPosition: source.position,
        parentId: [source, child, descendant][depth].id,
        beforeEntryId: null
      })
    ).toThrow('目录不能移入自身或子目录');
    expect(service.listEntries(workId)).toEqual(original);
  });

  it.each(['parent', 'position'])('原 %s 已变化时拒绝迟到移动，同命令重试返回原结果', change => {
    const source = entry('序章', 'document');
    const other = entry('尾声', 'document');
    const folder = entry('第一卷', 'directory');
    const command = {
      commandId: randomUUID(),
      workId,
      entryId: source.id,
      expectedParentId: source.parentId,
      expectedPosition: source.position,
      parentId: change === 'parent' ? folder.id : null,
      beforeEntryId: null
    };
    const moved = service.moveEntry(command);
    const original = service.listEntries(workId);
    expect(service.moveEntry(command)).toEqual(moved);
    expect(() =>
      service.moveEntry({
        ...command,
        commandId: randomUUID(),
        parentId: null,
        beforeEntryId: other.id
      })
    ).toThrowError(
      expect.objectContaining({
        code: 'entry-location-conflict',
        actualParentId: moved.parentId,
        actualPosition: moved.position
      })
    );
    expect(service.listEntries(workId)).toEqual(original);
  });

  it('资料排序独立于文稿树，移动后的旧命令重试保留最新位置', async () => {
    const manuscript = entry('正文', 'document');
    const resources = ['人物', '地点', '设定'].map(title =>
      service.createEntry({
        commandId: randomUUID(),
        workId,
        parentId: null,
        section: 'resource',
        kind: 'directory',
        title
      })
    );
    const source = resources[2];
    const command = {
      commandId: randomUUID(),
      workId,
      entryId: source.id,
      expectedParentId: source.parentId,
      expectedPosition: source.position,
      parentId: null,
      beforeEntryId: resources[0].id
    };
    const first = service.moveEntry(command);
    service.moveEntry({
      ...command,
      commandId: randomUUID(),
      expectedPosition: first.position,
      beforeEntryId: null
    });
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));
    expect(service.moveEntry(command)).toEqual(first);
    expect(() => service.moveEntry({ ...command, beforeEntryId: null })).toThrow('同一命令不能用于不同操作或参数');
    const current = service.listEntries(workId);
    expect(current.filter(item => item.section === 'manuscript')).toEqual([manuscript]);
    expect(current.filter(item => item.section === 'resource')).toEqual(resources);
  });

  it('移动回执写入失败会回滚两个目录的顺序，重开后同命令可重试', async () => {
    const folder = entry('第一卷', 'directory');
    const source = entry('序章', 'document');
    entry('尾声', 'document');
    const first = entry('第一章', 'document', folder.id);
    const last = entry('第二章', 'document', folder.id);
    const original = service.listEntries(workId);
    const command = {
      commandId: randomUUID(),
      workId,
      entryId: source.id,
      expectedParentId: source.parentId,
      expectedPosition: source.position,
      parentId: folder.id,
      beforeEntryId: first.id
    };
    const fault = new Database(join(rootDir, 'works', workId, 'work.sqlite'));
    try {
      fault.exec(`CREATE TRIGGER fail_move BEFORE INSERT ON command_receipts BEGIN
        SELECT RAISE(ABORT, '故障注入：移动回执写入失败');
      END;`);
      expect(() => service.moveEntry(command)).toThrow('故障注入：移动回执写入失败');
      service.close();
      service = new CreationService(await openCreationStorage({ rootDir }));
      expect(service.listEntries(workId)).toEqual(original);
      fault.exec('DROP TRIGGER fail_move;');
      const moved = service.moveEntry(command);
      expect(moved).toEqual({ ...source, parentId: folder.id, position: 0 });
      expect(
        service
          .listEntries(workId)
          .filter(item => item.parentId === folder.id)
          .map(item => item.id)
      ).toEqual([source.id, first.id, last.id]);
    } finally {
      fault.close();
    }
  });

  it('文稿移到目录内指定位置，重开后保留身份、正文修订和输入草稿', async () => {
    const folder = entry('第一卷', 'directory');
    const source = entry('序章', 'document');
    const first = entry('第一章', 'document', folder.id);
    const last = entry('第二章', 'document', folder.id);
    const draft = service.writeDraft({
      workId,
      documentId: source.id,
      expectedRevisionId: source.revisionId,
      draftId: randomUUID(),
      expectedDraftVersion: null,
      title: source.title,
      format: 'txt',
      content: '未完成的序章。'
    });
    const moved = service.moveEntry({
      commandId: randomUUID(),
      workId,
      entryId: source.id,
      expectedParentId: source.parentId,
      expectedPosition: source.position,
      parentId: folder.id,
      beforeEntryId: first.id
    });
    expect(moved).toEqual({ ...source, parentId: folder.id, position: 0 });
    service.close();
    service = new CreationService(await openCreationStorage({ rootDir }));

    expect(
      service
        .listEntries(workId)
        .filter(item => item.parentId === folder.id)
        .map(item => item.id)
    ).toEqual([source.id, first.id, last.id]);
    expect(service.readDocument(workId, source.id)).toEqual({ ...moved, content: '序章的正文。', attributes: null });
    expect(service.readDraftState(workId, source.id)).toEqual(draft);
    const saved = service.saveDocument({
      commandId: draft.version!,
      workId,
      documentId: source.id,
      expectedRevisionId: source.revisionId,
      title: source.title,
      format: 'txt',
      content: '未完成的序章。'
    });
    expect(saved.parentId).toBe(folder.id);
    expect(saved.position).toBe(0);
    expect(service.readDocument(workId, source.id).content).toBe('未完成的序章。');
  });
});
