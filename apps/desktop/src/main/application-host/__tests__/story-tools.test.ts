import { defineTool } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import { expect, it } from 'vitest';

import {
  setupWorkSession,
  creation,
  host,
  id,
  workId,
  documentId,
  revisionId,
  value,
  call,
  restartWithTools,
  load,
  pending,
  observeRequests,
  decidePending,
  structured,
  createResource
} from './work-session-fixture';

setupWorkSession();

it('审阅模式下事件写入本会话候选：省略发生位置取出处章节，修改只改提供的字段，移除新建事件即撤回', async () => {
  await load('work_record');
  const resourceId = await createResource('柳七');
  const created = await call('work_record_write', {
    workId,
    resourceIds: [resourceId],
    text: '柳七夜入城',
    sourceId: documentId,
    sourceRevisionId: revisionId,
    basis: '斥候回营。'
  });
  expect(created.isError).toBe(false);
  const record = value(structured(created)).record as { recordId: string; revisionId?: string };
  expect(value(structured(created))).toMatchObject({
    kind: 'pending',
    record: {
      resourceIds: [resourceId],
      source: { kind: 'chapter', chapterId: documentId, revisionId },
      placement: { kind: 'chapter', chapterId: documentId },
      storyTime: ''
    }
  });
  const listed = await call('work_record_ls', { workId, resourceId });
  expect(value(structured(listed))).toMatchObject([{ recordId: record.recordId, text: '柳七夜入城' }]);
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  await load('work_record_ls', other);
  expect(value(structured(await call('work_record_ls', { workId }, randomUUID(), undefined, other)))).toEqual([]);

  const change = pending().find(item => item.target === 'record')!;
  const updated = await call('work_record_write', {
    workId,
    recordId: record.recordId,
    expectedRevisionId: change.version,
    storyTime: '三更',
    basis: '斥候回营。'
  });
  expect(value(structured(updated))).toMatchObject({
    kind: 'pending',
    record: { text: '柳七夜入城', storyTime: '三更', placement: { kind: 'chapter', chapterId: documentId } }
  });
  const removed = await call('work_record_write', {
    workId,
    recordId: record.recordId,
    expectedRevisionId: pending().find(item => item.target === 'record')!.version,
    remove: true,
    basis: ''
  });
  expect(value(structured(removed)).kind).toBe('withdrawn');
  expect(pending().map(item => item.target)).toEqual(['entry']);
});

it('关系写入本会话候选，修改只提交改动的建立或结束，列出时给出状态与已用类型', async () => {
  await load('work_relation');
  const master = await createResource('顾长风');
  const pupil = await createResource('沈霁');
  const created = await call('work_relation_write', {
    workId,
    resourceIds: [master, pupil],
    type: '师徒',
    directed: true,
    titles: ['师父', '徒弟'],
    milestones: [{ kind: 'start', sourceId: documentId, sourceRevisionId: revisionId }],
    basis: '收沈霁为徒。'
  });
  expect(created.isError).toBe(false);
  const relation = value(structured(created)).relation as {
    relationId: string;
    milestones: { id: string }[];
  };
  expect(value(structured(created))).toMatchObject({
    kind: 'pending',
    relation: {
      resourceIds: [master, pupil],
      milestones: [
        {
          kind: 'start',
          source: { kind: 'chapter', chapterId: documentId, revisionId },
          placement: { kind: 'chapter', chapterId: documentId },
          storyTime: ''
        }
      ]
    }
  });
  const startId = relation.milestones[0]!.id;

  const change = () => pending().find(item => item.target === 'relation')!;
  const updated = await call('work_relation_write', {
    workId,
    relationId: relation.relationId,
    expectedRevisionId: change().version,
    milestones: [
      { milestoneId: startId, storyTime: '景和三年' },
      { kind: 'end', placement: 'undetermined' }
    ],
    basis: ''
  });
  expect(value(structured(updated))).toMatchObject({
    kind: 'pending',
    relation: {
      titles: ['师父', '徒弟'],
      milestones: [
        { id: startId, kind: 'start', placement: { kind: 'chapter', chapterId: documentId }, storyTime: '景和三年' },
        { kind: 'end', source: { kind: 'author' }, placement: { kind: 'undetermined' } }
      ]
    }
  });
  const listed = value(structured(await call('work_relation_ls', { workId, resourceId: pupil, asOf: documentId })));
  expect(listed).toMatchObject({
    relations: [{ relationId: relation.relationId, state: 'active' }],
    types: expect.arrayContaining([{ type: '师徒', directed: true, titles: ['师父', '徒弟'] }])
  });
  const missing = await call('work_relation_write', {
    workId,
    relationId: relation.relationId,
    expectedRevisionId: change().version,
    milestones: [{ milestoneId: randomUUID(), storyTime: '' }],
    basis: ''
  });
  expect(structured(missing)).toMatchObject({ ok: false, error: { message: '要修改的建立或结束不存在' } });
  const unplaced = await call('work_relation_write', {
    workId,
    relationId: relation.relationId,
    expectedRevisionId: change().version,
    milestones: [{ kind: 'end' }],
    basis: ''
  });
  expect(structured(unplaced)).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
  const removed = await call('work_relation_write', {
    workId,
    relationId: relation.relationId,
    expectedRevisionId: change().version,
    remove: true,
    basis: ''
  });
  expect(value(structured(removed)).kind).toBe('withdrawn');
  expect(pending().some(item => item.target === 'relation')).toBe(false);
});

it('直接修改模式下事件生成正式修订，未提供出处与发生位置时拒绝新建', async () => {
  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  await load('work_record');
  const resourceId = await createResource('沈霁');
  const missing = await call('work_record_write', { workId, resourceIds: [resourceId], text: '拜师', basis: '' });
  expect(missing.isError).toBe(true);
  expect(structured(missing)).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
  const saved = await call('work_record_write', {
    workId,
    resourceIds: [resourceId],
    text: '拜师',
    placement: 'opening',
    basis: ''
  });
  expect(value(structured(saved))).toMatchObject({
    kind: 'saved',
    record: { source: { kind: 'author' }, placement: { kind: 'opening' } }
  });
  const record = value(structured(saved)).record as { recordId: string; revisionId: string };
  const snapshot = value(creation.executeAuthor({ method: 'snapshot', input: { workId } }));
  expect(snapshot.kind === 'work' && snapshot.records.map(item => item.text)).toEqual(['拜师']);
  const removed = await call('work_record_write', {
    workId,
    recordId: record.recordId,
    expectedRevisionId: record.revisionId,
    remove: true,
    basis: ''
  });
  expect(value(structured(removed)).kind).toBe('removed');
  expect(value(structured(await call('work_record_ls', { workId })))).toEqual([]);
});

it('讨论模式拒绝事件写入，下一条作者消息携带事件处理结果', async () => {
  const nestedRecord = defineTool({
    name: 'nested_record',
    label: '嵌套事件写入',
    description: '经真实 SDK 上下文写入事件。',
    parameters: Type.Object({ input: Type.Record(Type.String(), Type.Unknown()) }),
    async execute(_callId, { input }, _signal, _onUpdate, ctx) {
      const outcome = await ctx.executeTool('work_record_write', input);
      return { ...outcome.result, isError: outcome.isError };
    }
  });
  const runtime = await restartWithTools([nestedRecord]);
  const requests = await observeRequests(runtime);
  const resourceId = value(
    creation.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '沈霁',
        format: 'markdown',
        content: ''
      }
    })
  ).id;
  const input = { workId, resourceIds: [resourceId], text: '沈霁守城', placement: documentId, basis: '将军守城。' };
  await host.execute({ method: 'mode', input: { id, mode: 'discuss' } });
  // 讨论模式下 tool_search 只留下读工具；延迟写工具仍可经嵌套调用触达，由宿主授权拒绝。
  await load('work_record');
  const session = host.liveSession(id)!;
  expect(session.getActiveToolNames()).toContain('work_record_ls');
  expect(session.getActiveToolNames()).not.toContain('work_record_write');
  const nested = call('nested_record', { input });
  await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
  await host.execute({ method: 'approve', input: { id: host.snapshot().approvals[0].id, allow: true } });
  expect((await nested).result.content).toEqual([{ type: 'text', text: '当前为讨论模式，作品只读' }]);
  expect(pending()).toEqual([]);
  await host.execute({ method: 'mode', input: { id, mode: 'review' } });
  await load('work_record_write');
  expect((await call('work_record_write', input)).isError).toBe(false);
  expect(pending()).toHaveLength(1);
  decidePending('reject');
  expect(requests).toHaveLength(0);
  await host.execute({ method: 'prompt', input: { id, text: '继续讨论这条事件' } });
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].messages).toContain('事件“沈霁守城”已拒绝');
  expect(requests[0].messages).toContain('targetId');
});

it('审阅模式改写章节后，事件出处可用读到的待接受版本；拒绝正文后事件随之拒绝，下一条作者消息说明原因', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  await load('work_record');
  const resourceId = await createResource('沈霁');
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '城破。' }))
      .isError
  ).toBe(false);
  const draft = value(structured(await call('work_read', { workId, entryId: documentId }))) as { revisionId: string };
  expect(draft.revisionId).not.toBe(revisionId);
  const written = await call('work_record_write', {
    workId,
    resourceIds: [resourceId],
    text: '城破',
    sourceId: documentId,
    sourceRevisionId: draft.revisionId,
    basis: '城破。'
  });
  expect(written.isError).toBe(false);
  decidePending('reject', pending().find(change => change.targetId === documentId)!.id);
  expect(pending()).toMatchObject([{ targetId: resourceId }]);
  decidePending('reject');
  expect(requests).toHaveLength(0);
  await host.execute({ method: 'prompt', input: { id, text: '解释刚才拒绝的结果' } });
  await expect.poll(() => requests.length).toBe(1);
  expect(requests[0].messages).toContain('作者拒绝了来源正文');
});
