import Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import type { EntryReviewView, ResourceAttributePatch, ResourceAttributes } from '@chaptale/creation/contracts';

import { application, target, value } from './fixtures/review.ts';
import { searchEntries } from './fixtures/search.ts';

type Fixture = Awaited<ReturnType<typeof application>>;

function read(fixture: Fixture, documentId: string) {
  return value(fixture.app.executeAuthor({ method: 'readDocument', input: { workId: fixture.work.id, documentId } }));
}

function resource(fixture: Fixture) {
  const entry = value(
    fixture.app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '沈霁',
        format: 'txt',
        content: '守城的将军。'
      }
    })
  );
  value(
    fixture.app.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        documentId: entry.id,
        expectedRevisionId: entry.revisionId,
        title: entry.title,
        format: 'txt',
        content: '守城的将军。',
        attributes: { type: '人物', aliases: ['阿霁'], tags: ['主角'], cover: null }
      }
    })
  );
  return read(fixture, entry.id);
}

function proposeAttributes(fixture: Fixture, documentId: string, attributes: ResourceAttributePatch, content?: string) {
  const seen = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'readDocument',
      input: { workId: fixture.work.id, documentId }
    })
  );
  const result = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'writeContent',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        documentId,
        expectedRevisionId: seen.revisionId,
        attributes,
        ...(content !== undefined && { content })
      }
    })
  );
  if (result.kind !== 'pending') throw new Error('预期生成待接受修改');
  return result.change;
}

function review(fixture: Fixture, changeId: string) {
  return value(fixture.app.executeAuthor({ method: 'readReview', input: { changeId } })) as EntryReviewView;
}

function saveAttributes(fixture: Fixture, documentId: string, fields: Partial<ResourceAttributes>) {
  const current = read(fixture, documentId);
  return fixture.app.executeAuthor({
    method: 'saveDocument',
    input: {
      commandId: randomUUID(),
      workId: fixture.work.id,
      documentId,
      expectedRevisionId: current.revisionId,
      title: current.title,
      format: current.format,
      content: current.content,
      attributes: { ...current.attributes!, ...fields }
    }
  });
}

it('Agent 新建资料时属性与正文一起保存为修订，重开后保留并能按别名检索', async () => {
  const fixture = await application();
  const created = value(
    fixture.app.executeAgent(
      { ...fixture.context, mode: 'direct' },
      {
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: fixture.work.id,
          parentId: null,
          section: 'resource',
          kind: 'document',
          title: '沈霁',
          format: 'txt',
          content: '守城的将军。',
          attributes: { type: '人物', aliases: ['阿霁'], tags: ['主角'] }
        }
      }
    )
  );
  if (created.kind !== 'saved') throw new Error('预期保存正式资料');
  await fixture.reopen();
  expect(read(fixture, created.entry.id)).toMatchObject({
    content: '守城的将军。',
    attributes: { type: '人物', aliases: ['阿霁'], tags: ['主角'], cover: null }
  });
  const found = searchEntries(fixture.app, { workId: fixture.work.id, query: '阿霁' });
  expect(found.map(entry => entry.id)).toEqual([created.entry.id]);
});

it('Agent 单独更新传入的属性，数组整体替换并可清空；命令重试保持同一修订', async () => {
  const fixture = await application();
  const document = resource(fixture);
  const context = { ...fixture.context, mode: 'direct' as const };
  const command = {
    method: 'writeContent' as const,
    input: {
      commandId: randomUUID(),
      workId: fixture.work.id,
      documentId: document.id,
      expectedRevisionId: document.revisionId,
      attributes: { aliases: ['小沈'] }
    }
  };
  const saved = value(fixture.app.executeAgent(context, command));
  expect(read(fixture, document.id)).toMatchObject({
    title: '沈霁',
    content: '守城的将军。',
    attributes: { type: '人物', aliases: ['小沈'], tags: ['主角'], cover: null }
  });
  const revisionId = read(fixture, document.id).revisionId;
  expect(value(fixture.app.executeAgent(context, command))).toEqual(saved);
  expect(read(fixture, document.id).revisionId).toBe(revisionId);
  value(
    fixture.app.executeAgent(context, {
      method: 'writeContent',
      input: {
        ...command.input,
        commandId: randomUUID(),
        expectedRevisionId: revisionId,
        attributes: { type: '', aliases: [], tags: [] }
      }
    })
  );
  expect(read(fixture, document.id).attributes).toEqual({ type: '', aliases: [], tags: [], cover: null });
});

it.each(['accept', 'reject'] as const)('属性整组 %s 后正文继续待审，重开与重复决定保持结果', async decision => {
  const fixture = await application();
  const document = resource(fixture);
  const attributes = { type: '将领', aliases: ['小沈'], tags: ['守城'] };
  const change = proposeAttributes(fixture, document.id, attributes, '出征的将军。');
  const command = {
    method: 'decideReview' as const,
    input: {
      commandId: randomUUID(),
      ...target(review(fixture, change.id)),
      decision,
      part: 'attributes' as const
    }
  };
  const decided = value(fixture.app.executeAuthor<'decideReview'>(command));
  expect(decided.status).toBe('pending');
  const expected = decision === 'accept' ? { ...attributes, cover: null } : document.attributes;
  expect(read(fixture, document.id)).toMatchObject({ content: '守城的将军。', attributes: expected });
  const revisionId = read(fixture, document.id).revisionId;
  expect(value(fixture.app.executeAuthor<'decideReview'>(command))).toEqual(decided);
  expect(read(fixture, document.id).revisionId).toBe(revisionId);
  await fixture.reopen();
  const remaining = review(fixture, change.id);
  expect(remaining.candidate).toMatchObject({ content: '出征的将军。', attributes: expected });
  value(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(remaining), decision: 'accept' }
    })
  );
  expect(read(fixture, document.id)).toMatchObject({ content: '出征的将军。', attributes: expected });
});

it('逐块接受完正文后，剩余属性继续待审', async () => {
  const fixture = await application();
  const document = resource(fixture);
  const change = proposeAttributes(fixture, document.id, { aliases: ['小沈'] }, '出征的将军。');
  const decided = value(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: {
        commandId: randomUUID(),
        ...target(review(fixture, change.id)),
        decision: 'accept',
        range: { fromA: 0, toA: 2, fromB: 0, toB: 2 }
      }
    })
  );
  expect(decided.status).toBe('pending');
  expect(read(fixture, document.id)).toMatchObject({
    content: '出征的将军。',
    attributes: { aliases: ['阿霁'] }
  });
  expect(review(fixture, change.id).candidate.attributes?.aliases).toEqual(['小沈']);
  expect(
    value(
      fixture.app.executeAuthor({ method: 'listPendingChanges', input: { workId: fixture.work.id, sessionId: null } })
    ).map(item => item.id)
  ).toEqual([change.id]);
});

it('作者和 Agent 改不同属性时按字段合并，接受时保留作者的标签', async () => {
  const fixture = await application();
  const document = resource(fixture);
  const change = proposeAttributes(fixture, document.id, { aliases: ['小沈'] }, '率军守城的将军。');
  value(saveAttributes(fixture, document.id, { tags: ['配角'] }));
  const view = review(fixture, change.id);
  expect(view.conflicts).toEqual([]);
  expect(view.candidate.attributes).toEqual({ type: '人物', aliases: ['小沈'], tags: ['配角'], cover: null });
  value(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  );
  expect(read(fixture, document.id)).toMatchObject({
    content: '率军守城的将军。',
    attributes: { type: '人物', aliases: ['小沈'], tags: ['配角'], cover: null }
  });
});

it.each([
  { field: 'type', proposed: '组织', current: '地点' },
  { field: 'aliases', proposed: ['小沈'], current: ['沈将军'] },
  { field: 'tags', proposed: ['守城'], current: ['配角'] }
] as const)('双方修改 $field 时报告冲突，拒绝属性后保留作者值', async ({ field, proposed, current }) => {
  const fixture = await application();
  const document = resource(fixture);
  const change = proposeAttributes(fixture, document.id, { [field]: proposed });
  value(saveAttributes(fixture, document.id, { [field]: current }));
  const view = review(fixture, change.id);
  expect(view.conflicts.map(conflict => conflict.field)).toEqual([field]);
  expect(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept', part: 'attributes' }
    })
  ).toMatchObject({ ok: false, error: { message: '资料属性有冲突，请先处理冲突再接受' } });
  expect(
    value(
      fixture.app.executeAuthor({
        method: 'decideReview',
        input: { commandId: randomUUID(), ...target(view), decision: 'reject', part: 'attributes' }
      })
    ).status
  ).toBe('rejected');
  expect(read(fixture, document.id).attributes).toMatchObject({ [field]: current });
});

it('属性候选与别名检索只在本会话可见，接受后进入正式检索', async () => {
  const fixture = await application();
  const document = resource(fixture);
  const change = proposeAttributes(fixture, document.id, { aliases: ['青鸟'] });
  const query = { workId: fixture.work.id, query: '青鸟' };
  expect(searchEntries(fixture.app, query, fixture.context).map(entry => entry.id)).toEqual([document.id]);
  expect(searchEntries(fixture.app, query)).toEqual([]);
  expect(searchEntries(fixture.app, query, { ...fixture.context, sessionId: 'session-b' })).toEqual([]);
  await fixture.reopen();
  expect(
    value(
      fixture.app.executeAuthor({
        method: 'decideReview',
        input: {
          commandId: randomUUID(),
          ...target(review(fixture, change.id)),
          decision: 'accept',
          part: 'attributes'
        }
      })
    ).status
  ).toBe('accepted');
  expect(searchEntries(fixture.app, query).map(entry => entry.id)).toEqual([document.id]);
});

it('属性候选保留作者后选的封面，Agent 不能提交封面字段', async () => {
  const fixture = await application();
  const document = resource(fixture);
  const change = proposeAttributes(fixture, document.id, { aliases: ['小沈'] });
  const file = join(fixture.rootDir, '封面.png');
  await writeFile(
    file,
    Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
      'base64'
    )
  );
  const added = value(
    await fixture.app.execute({
      method: 'addFiles',
      input: { commandId: randomUUID(), workId: fixture.work.id, parentId: null, paths: [file] }
    })
  );
  const cover = added.entries[0]!.id;
  value(saveAttributes(fixture, document.id, { cover }));
  const view = review(fixture, change.id);
  expect(view.candidate.attributes?.cover).toBe(cover);
  value(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept', part: 'attributes' }
    })
  );
  expect(read(fixture, document.id).attributes).toEqual({ type: '人物', aliases: ['小沈'], tags: ['主角'], cover });
  const current = read(fixture, document.id);
  expect(
    fixture.app.executeAgent(
      { ...fixture.context, mode: 'direct' },
      {
        method: 'writeContent',
        input: {
          commandId: randomUUID(),
          workId: fixture.work.id,
          documentId: document.id,
          expectedRevisionId: current.revisionId,
          attributes: { cover: null }
        }
      }
    )
  ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
  expect(read(fixture, document.id).attributes?.cover).toBe(cover);
});

it.each([
  { mode: 'discuss', section: 'resource', attributes: { type: '人物' }, code: 'failed' },
  { mode: 'direct', section: 'manuscript', attributes: { type: '人物' }, code: 'failed' },
  { mode: 'direct', section: 'resource', attributes: {}, code: 'invalid-request' }
] as const)('属性写入遵守模式与资料边界：$mode/$section/$code', async ({ mode, section, attributes, code }) => {
  const fixture = await application();
  const document = section === 'resource' ? resource(fixture) : fixture.read();
  expect(
    fixture.app.executeAgent(
      { ...fixture.context, mode },
      {
        method: 'writeContent',
        input: {
          commandId: randomUUID(),
          workId: fixture.work.id,
          documentId: document.id,
          expectedRevisionId: document.revisionId,
          attributes
        }
      }
    )
  ).toMatchObject({ ok: false, error: { code } });
  expect(read(fixture, document.id)).toEqual(document);
});

it('更新请求必须包含正文或属性，空操作不会生成修订', async () => {
  const fixture = await application();
  const document = resource(fixture);
  expect(
    fixture.app.executeAgent(
      { ...fixture.context, mode: 'direct' },
      {
        method: 'writeContent',
        input: {
          commandId: randomUUID(),
          workId: fixture.work.id,
          documentId: document.id,
          expectedRevisionId: document.revisionId
        }
      }
    )
  ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
  expect(read(fixture, document.id)).toEqual(document);
});

it('新资料的属性随整篇接受，不能先单独建立属性', async () => {
  const fixture = await application();
  const result = value(
    fixture.app.executeAgent(fixture.context, {
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: fixture.work.id,
        parentId: null,
        section: 'resource',
        kind: 'document',
        title: '柳七',
        format: 'txt',
        content: '夜入城的斥候。',
        attributes: { type: '人物', aliases: ['七郎'], tags: [] }
      }
    })
  );
  if (result.kind !== 'pending') throw new Error('预期生成待接受修改');
  const view = review(fixture, result.change.id);
  expect(view.current).toBeNull();
  expect(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept', part: 'attributes' }
    })
  ).toMatchObject({ ok: false, error: { message: '这项修改没有资料属性可单独处理' } });
  value(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(view), decision: 'accept' }
    })
  );
  expect(read(fixture, result.change.targetId)).toMatchObject({
    content: '夜入城的斥候。',
    attributes: { type: '人物', aliases: ['七郎'], tags: [], cover: null }
  });
});

it('候选更新后迟到的属性决定被拒绝，正式属性保持原值', async () => {
  const fixture = await application();
  const document = resource(fixture);
  const first = proposeAttributes(fixture, document.id, { aliases: ['小沈'] });
  const before = review(fixture, first.id);
  proposeAttributes(fixture, document.id, { aliases: ['青鸟'] });
  expect(
    fixture.app.executeAuthor({
      method: 'decideReview',
      input: { commandId: randomUUID(), ...target(before), decision: 'accept', part: 'attributes' }
    })
  ).toMatchObject({ ok: false, error: { message: '待接受修改已有新版本，请刷新后审阅' } });
  expect(read(fixture, document.id).attributes?.aliases).toEqual(['阿霁']);
  expect(review(fixture, first.id).candidate.attributes?.aliases).toEqual(['青鸟']);
});

it('属性接受已提交而本机进度失败时，重启凭回执恢复并保留作者后续属性', async () => {
  const fixture = await application();
  const document = resource(fixture);
  const change = proposeAttributes(fixture, document.id, { aliases: ['小沈'] }, '出征的将军。');
  const input = {
    commandId: randomUUID(),
    ...target(review(fixture, change.id)),
    decision: 'accept' as const,
    part: 'attributes' as const
  };
  const fault = new Database(join(fixture.rootDir, 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_progress BEFORE UPDATE ON pending_changes BEGIN SELECT RAISE(ABORT, '属性审阅进度故障'); END"
    );
    expect(fixture.app.executeAuthor({ method: 'decideReview', input })).toMatchObject({
      ok: false,
      error: { message: '属性审阅进度故障' }
    });
    expect(read(fixture, document.id)).toMatchObject({ content: '守城的将军。', attributes: { aliases: ['小沈'] } });
    fault.exec('DROP TRIGGER fail_progress');
    value(saveAttributes(fixture, document.id, { tags: ['作者补充'] }));
    const saved = read(fixture, document.id);
    await fixture.reopen();
    const remaining = review(fixture, change.id);
    expect(remaining.change.status).toBe('pending');
    expect(remaining.candidate).toMatchObject({
      content: '出征的将军。',
      attributes: { aliases: ['小沈'], tags: ['作者补充'] }
    });
    expect(value(fixture.app.executeAuthor<'decideReview'>({ method: 'decideReview', input })).status).toBe('pending');
    expect(read(fixture, document.id)).toEqual(saved);
  } finally {
    fault.close();
  }
});
