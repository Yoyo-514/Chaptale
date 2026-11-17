import { runToolCall } from '@earendil-works/pi-agent-core';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import type { EntrySnapshot } from '@chaptale/creation/contracts';

import {
  setupWorkSession,
  root,
  creation,
  host,
  id,
  workId,
  documentId,
  revisionId,
  value,
  call,
  read,
  pending
} from './work-session-fixture';

setupWorkSession();

it('未归属作品的会话发现作品、列出根目录并按稳定身份读取指定行', async () => {
  const tools = host.snapshot().tools;
  expect(tools.filter(name => name.startsWith('work_'))).toHaveLength(14);
  expect(tools).toEqual(
    expect.arrayContaining([
      'work_ls',
      'work_read',
      'work_find',
      'work_grep',
      'work_search',
      'work_edit',
      'work_write',
      'work_mkdir',
      'work_mv',
      'work_rm',
      'work_record_ls',
      'work_record_write',
      'work_relation_ls',
      'work_relation_write'
    ])
  );
  expect(tools.filter(name => name.startsWith('creation_'))).toEqual([]);
  const works = await call('work_ls', { workId: null });
  expect(works.isError).toBe(false);
  expect(works.result.structuredContent).toMatchObject([{ workId, title: '长夜行' }]);
  const entries = await call('work_ls', { workId, entryId: null });
  expect(entries.isError).toBe(false);
  expect(entries.result.structuredContent).toMatchObject([{ workId, entryId: documentId, title: '序章' }]);
  const document = await call('work_read', { workId, entryId: documentId, offset: 2, limit: 1 });
  expect(document.isError).toBe(false);
  expect(document.result.structuredContent).toMatchObject({
    workId,
    entryId: documentId,
    revisionId,
    content: '城外下雪。'
  });
  expect(host.snapshot().approvals).toEqual([]);
});

it('资料文件条目在目录中附带大小与路径，图片交给 pi 读取，其他文件提示用原始工具读取', async () => {
  const outside = join(root, 'outside');
  await mkdir(outside);
  // 1×1 透明 PNG。
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
    'base64'
  );
  await writeFile(join(outside, '地图.png'), png);
  await writeFile(join(outside, '设定.pdf'), 'pdf');
  const report = value(
    await creation.execute({
      method: 'addFiles',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        paths: [join(outside, '地图.png'), join(outside, '设定.pdf')]
      }
    })
  );
  const [image, pdf] = report.entries;
  const listed = await call('work_ls', { workId, section: 'resource' });
  expect(listed.result.structuredContent).toMatchObject([
    { entryId: image!.id, kind: 'file', title: '地图.png', file: { image: true, size: png.length } },
    { entryId: pdf!.id, kind: 'file', title: '设定.pdf', file: { image: false, size: 3 } }
  ]);
  const path = (listed.result.structuredContent as { file: { path: string } }[])[1]!.file.path;
  const imageRead = await call('work_read', { workId, entryId: image!.id });
  expect(imageRead.isError).toBe(false);
  expect(imageRead.result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Read image file') })
    ])
  );
  const other = await call('work_read', { workId, entryId: pdf!.id });
  expect(other.isError).toBe(true);
  expect(other.result.structuredContent).toBeUndefined();
  expect(other.result.details).toMatchObject({
    ok: false,
    error: { message: `这个文件条目不是图片，需要时用原始工具读取：${path}` }
  });
});

it('Markdown 插图对 Agent 显示为占位，编辑时还原，不能新建插图', async () => {
  const chapter = value(
    creation.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '彩页',
        format: 'markdown',
        content: '开头。\n![城门](entry:img-1)\n结尾。'
      }
    })
  );
  const reread = await call('work_read', { workId, entryId: chapter.id });
  expect(reread.result.structuredContent).toMatchObject({ content: '开头。\n[插图：城门 entry:img-1]\n结尾。' });
  const moved = await call('work_edit', {
    workId,
    entryId: chapter.id,
    expectedRevisionId: chapter.revisionId,
    oldText: '开头。\n[插图：城门 entry:img-1]\n结尾。',
    newText: '开头。\n结尾。\n[插图：城门 entry:img-1]'
  });
  expect(moved.isError).toBe(false);
  const [change] = pending();
  expect((change!.candidate as EntrySnapshot).content).toBe('开头。\n结尾。\n![城门](entry:img-1)');
  const created = await call('work_edit', {
    workId,
    entryId: chapter.id,
    expectedRevisionId: (change!.candidate as EntrySnapshot).revisionId,
    oldText: '开头。',
    newText: '开头。\n[插图：新图 entry:img-2]'
  });
  expect(created.result.structuredContent).toBeUndefined();
  expect(created.result.details).toMatchObject({
    ok: false,
    error: { message: '不能新建插图，只能保留或移动正文中已有的插图' }
  });
});

it('默认读取完整正文，范围可读取至末尾，整篇覆盖允许清空正文', async () => {
  expect((await call('work_read', { workId, entryId: documentId })).result.structuredContent).toMatchObject({
    content: '将军守城。\n城外下雪。\n斥候回营。'
  });
  expect((await call('work_read', { workId, entryId: documentId, offset: 3 })).result.structuredContent).toMatchObject({
    content: '斥候回营。'
  });
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '' })).isError
  ).toBe(false);
  expect((await call('work_read', { workId, entryId: documentId })).result.structuredContent).toMatchObject({
    content: '',
    wordCount: 0
  });
});

it('精确编辑进入本会话候选，读取与其他会话、正式稿保持隔离，并拒绝陈旧修订', async () => {
  const input = { workId, entryId: documentId, expectedRevisionId: revisionId, oldText: '守城', newText: '出城' };
  const edited = await call('work_edit', input);
  expect(edited.isError).toBe(false);
  expect(edited.result.structuredContent).toMatchObject({ kind: 'pending', entry: { workId, entryId: documentId } });
  expect(read().content).toBe('将军守城。\n城外下雪。\n斥候回营。');
  const own = await call('work_read', { workId, entryId: documentId });
  expect(own.result.structuredContent).toMatchObject({ content: '将军出城。\n城外下雪。\n斥候回营。' });
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  const outside = await call('work_read', { workId, entryId: documentId }, randomUUID(), undefined, other);
  expect(outside.result.structuredContent).toMatchObject({ content: read().content });
  const stale = await call('work_edit', { ...input, oldText: '出城', newText: '回城' });
  expect(stale.isError).toBe(true);
  expect(stale.result.structuredContent).toBeUndefined();
  expect(stale.result.details).toMatchObject({ ok: false, error: { code: 'revision-conflict' } });
  expect(pending()).toHaveLength(1);
  expect(pending(other)).toEqual([]);
});

it('整篇写入区分新建和覆盖，保留既有标题格式，重复调用在后续改稿后仍返回原回执', async () => {
  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  const created = await call('work_write', {
    workId,
    parentId: null,
    title: '序章',
    section: 'resource',
    format: 'markdown',
    content: '# 人物资料'
  });
  expect(created.isError).toBe(false);
  const resource = value(creation.executeAuthor({ method: 'listEntries', input: { workId } })).find(
    entry => entry.section === 'resource'
  )!;
  expect(resource.id).not.toBe(documentId);
  expect(created.result.structuredContent).toMatchObject({
    kind: 'saved',
    entry: { workId, entryId: resource.id, format: 'markdown' }
  });
  const input = { workId, entryId: documentId, expectedRevisionId: revisionId, content: '新的正文。' };
  const callId = randomUUID();
  const first = await call('work_write', input, callId);
  expect(first.isError).toBe(false);
  expect(read()).toMatchObject({ title: '序章', format: 'txt', content: '新的正文。' });
  const saved = read();
  value(
    creation.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId,
        expectedRevisionId: saved.revisionId,
        title: '改名后',
        format: 'markdown',
        content: '作者后续改稿。'
      }
    })
  );
  const later = read();
  const retry = await call('work_write', input, callId);
  expect(retry.isError).toBe(false);
  expect(retry.result.structuredContent).toEqual(first.result.structuredContent);
  expect(read()).toEqual(later);
  expect((await call('work_write', { ...input, content: '其他内容。' }, callId)).isError).toBe(true);
  expect(read()).toEqual(later);
});

it('作品写工具支持新建资料属性和单独更新，审阅读取包含本会话属性候选', async () => {
  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  const created = await call('work_write', {
    workId,
    parentId: null,
    title: '沈霁',
    section: 'resource',
    format: 'txt',
    content: '守城的将军。',
    attributes: { type: '人物', aliases: ['阿霁'], tags: ['主角'] }
  });
  expect(created.isError, JSON.stringify(created.result)).toBe(false);
  const resource = value(creation.executeAuthor({ method: 'listEntries', input: { workId } })).find(
    entry => entry.title === '沈霁'
  )!;
  const updated = await call('work_write', {
    workId,
    entryId: resource.id,
    expectedRevisionId: resource.revisionId,
    attributes: { aliases: ['小沈'] }
  });
  expect(updated.isError, JSON.stringify(updated.result)).toBe(false);
  const current = value(creation.executeAuthor({ method: 'readDocument', input: { workId, documentId: resource.id } }));
  expect(current).toMatchObject({
    content: '守城的将军。',
    attributes: { type: '人物', aliases: ['小沈'], tags: ['主角'], cover: null }
  });
  await host.execute({ method: 'mode', input: { id, mode: 'review' } });
  const proposed = await call('work_write', {
    workId,
    entryId: resource.id,
    expectedRevisionId: current.revisionId,
    attributes: { tags: [] }
  });
  expect(proposed.isError, JSON.stringify(proposed.result)).toBe(false);
  const seen = await call('work_read', { workId, entryId: resource.id });
  expect(seen.result.structuredContent).toMatchObject({
    pending: true,
    content: '守城的将军。',
    attributes: { type: '人物', aliases: ['小沈'], tags: [], cover: null }
  });
  expect(
    value(creation.executeAuthor({ method: 'readDocument', input: { workId, documentId: resource.id } })).attributes
  ).toEqual({ type: '人物', aliases: ['小沈'], tags: ['主角'], cover: null });
});

it('创建候选目录并移动、改名文稿，条目身份保持稳定，重复移动校验原位置', async () => {
  const directory = await call('work_mkdir', { workId, parentId: null, title: '第一卷', section: 'manuscript' });
  expect(directory.isError).toBe(false);
  const folder = pending().find(change => change.target === 'entry' && change.candidate.kind === 'directory')!
    .candidate as EntrySnapshot;
  const move = {
    workId,
    entryId: documentId,
    expectedParentId: null,
    expectedPosition: 0,
    parentId: folder.id,
    beforeEntryId: null
  };
  const moved = await call('work_mv', move);
  expect(moved.isError).toBe(false);
  const inside = await call('work_ls', { workId, entryId: folder.id });
  expect(inside.result.structuredContent).toMatchObject([{ entryId: documentId, parentId: folder.id, position: 0 }]);
  const renamed = await call('work_mv', {
    workId,
    entryId: documentId,
    expectedRevisionId: pending().find(change => change.targetId === documentId)!.version,
    title: '第一章'
  });
  expect(renamed.isError).toBe(false);
  expect(renamed.result.structuredContent).toMatchObject({
    entry: { entryId: documentId, parentId: folder.id, title: '第一章' }
  });
  const stale = await call('work_mv', move);
  expect(stale.isError).toBe(true);
  expect(stale.result.structuredContent).toBeUndefined();
  expect(stale.result.details).toMatchObject({ ok: false, error: { code: 'entry-location-conflict' } });
  expect(read()).toMatchObject({ id: documentId, parentId: null, title: '序章' });
  expect((await call('work_ls', { workId, entryId: documentId })).isError).toBe(true);
});

it('工具拒绝自报模式、会话和命令身份，合法请求使用宿主身份并保留幂等回执', async () => {
  const input = { workId, entryId: documentId, expectedRevisionId: revisionId, oldText: '守城', newText: '出城' };
  const callId = randomUUID();
  const identities: Array<Parameters<typeof runToolCall>[0]['arguments']> = [
    { mode: 'direct' },
    { sessionId: 'forged-session' },
    { commandId: 'forged-command' }
  ];
  for (const extra of identities) {
    expect((await call('work_edit', { ...input, ...extra }, callId)).isError).toBe(true);
  }
  expect(read().revisionId).toBe(revisionId);
  expect(pending()).toEqual([]);
  const first = await call('work_edit', input, callId);
  expect(first.isError).toBe(false);
  expect(pending()[0]).toMatchObject({ sessionId: id, targetId: documentId });
  expect(pending('forged-session')).toEqual([]);
  const retry = await call('work_edit', input, callId);
  expect(retry.isError).toBe(false);
  expect(retry.result.structuredContent).toEqual(first.result.structuredContent);
  expect(pending()).toHaveLength(1);
});

it('缺少定位或修订、混用新建与覆盖字段、无效范围和检索参数均被拒绝，作品保持原状', async () => {
  const invalid: Array<[string, Parameters<typeof runToolCall>[0]['arguments']]> = [
    ['work_ls', {}],
    ['work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, title: '混用', content: '混用' }],
    ['work_mv', { workId, entryId: documentId, parentId: null }],
    ['work_read', { workId, entryId: documentId, offset: 0 }],
    ['work_read', { workId, entryId: documentId, limit: 0 }],
    ['work_write', { workId, entryId: documentId, content: '缺少修订' }],
    ['work_write', { workId, parentId: null, title: '缺少分区', format: 'txt', content: '' }],
    ['work_edit', { workId, entryId: documentId, expectedRevisionId: revisionId, oldText: '', newText: '新内容' }],
    ['work_search', { workId, query: '  ', offset: 0, limit: 1 }],
    ['work_search', { workId, query: '将军', offset: 0, limit: 0 }]
  ];
  for (const [name, input] of invalid) expect((await call(name, input)).isError).toBe(true);
  expect(read().revisionId).toBe(revisionId);
  expect(pending()).toEqual([]);
});

it('取消的作品写调用保留正式稿和本会话候选原状', async () => {
  const cancelled = new AbortController();
  cancelled.abort();
  const result = await call(
    'work_write',
    {
      workId,
      entryId: documentId,
      expectedRevisionId: revisionId,
      content: '取消的改稿'
    },
    randomUUID(),
    cancelled.signal
  );
  expect(result.isError).toBe(true);
  expect(read().revisionId).toBe(revisionId);
  expect(pending()).toEqual([]);
});

it('新建候选与后续覆盖使用各自回执，重试新建保留同一条目及后续内容', async () => {
  const input = { workId, parentId: null, title: '人物', section: 'resource', format: 'markdown', content: '初稿' };
  const callId = randomUUID();
  const first = await call('work_write', input, callId);
  expect(first.isError).toBe(false);
  const candidate = pending()[0];
  expect(
    (
      await call('work_write', {
        workId,
        entryId: candidate.targetId,
        expectedRevisionId: candidate.version,
        content: '后续内容'
      })
    ).isError
  ).toBe(false);
  const retry = await call('work_write', input, callId);
  expect(retry.isError).toBe(false);
  expect(retry.result.structuredContent).toEqual(first.result.structuredContent);
  expect(pending()).toHaveLength(1);
  expect(pending()[0].candidate).toMatchObject({ id: candidate.targetId, content: '后续内容' });
});
