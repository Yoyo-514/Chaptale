import { runToolCall } from '@earendil-works/pi-agent-core';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { createHostApplication, type HostApplication } from '@chaptale/agent-host/application';
import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';
import { openCreationStorage } from '@chaptale/storage';

let root: string;
let creation: CreationApplication;
let host: HostApplication;
let id: string;
let workId: string;
let documentId: string;
let revisionId: string;

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-creation-tools-'));
  creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  host = await createHostApplication({
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    configDir: join(root, 'config'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'config', 'settings.json'),
    creation
  });
  await host.execute({
    method: 'saveProvider',
    input: {
      id: 'offline-tools',
      apiKey: 'offline-test-only',
      config: {
        baseUrl: 'http://127.0.0.1:9',
        api: 'openai-completions',
        models: [{ id: 'offline', name: '离线工具测试', contextWindow: 8192, maxTokens: 128 }]
      }
    }
  });
  id = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' } }
  })) as string;
  workId = value(
    creation.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  ).id;
  const document = value(
    creation.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '序章',
        format: 'txt',
        content: '将军守城。\n城外下雪。\n斥候回营。'
      }
    })
  );
  documentId = document.id;
  revisionId = document.revisionId;
});

afterEach(async () => {
  await host?.dispose();
  creation?.close();
  await rm(root, { recursive: true, force: true });
});

// 固定工具协议输入，经真实 SDK 工具管线执行，不请求模型或伪造回复。
function call(
  name: string,
  input: Parameters<typeof runToolCall>[0]['arguments'],
  toolCallId = randomUUID(),
  signal?: AbortSignal,
  sessionId = id
) {
  const session = host.liveSession(sessionId)!;
  const assistant = {
    role: 'assistant' as const,
    content: [{ type: 'toolCall' as const, id: toolCallId, name, arguments: input }],
    api: 'openai-completions',
    provider: 'offline-tools',
    model: 'offline',
    stopReason: 'toolUse' as const,
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  };
  return runToolCall(assistant.content[0], {
    assistantMessage: assistant,
    context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
    tools: session.agent.state.tools,
    beforeToolCall: session.agent.beforeToolCall,
    afterToolCall: session.agent.afterToolCall,
    signal
  });
}

function read() {
  return value(creation.executeAuthor({ method: 'readDocument', input: { workId, documentId } }));
}

function pending(sessionId = id) {
  return value(creation.executeAuthor({ method: 'listPendingChanges', input: { workId, sessionId } }));
}

it('未归属作品的会话发现作品、列出根目录并按稳定身份读取指定行', async () => {
  const tools = host.snapshot().tools;
  expect(tools.filter(name => name.startsWith('work_'))).toHaveLength(9);
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
      'work_mv'
    ])
  );
  expect(tools.filter(name => name.startsWith('creation_'))).toEqual([]);
  const works = await call('work_ls', { workId: null });
  expect(works.isError).toBe(false);
  expect(works.result.structuredContent).toMatchObject({ ok: true, value: [{ workId, title: '长夜行' }] });
  const entries = await call('work_ls', { workId, entryId: null });
  expect(entries.isError).toBe(false);
  expect(entries.result.structuredContent).toMatchObject({
    ok: true,
    value: [{ workId, entryId: documentId, title: '序章' }]
  });
  const document = await call('work_read', { workId, entryId: documentId, offset: 2, limit: 1 });
  expect(document.isError).toBe(false);
  expect(document.result.structuredContent).toMatchObject({
    ok: true,
    value: { workId, entryId: documentId, revisionId, content: '城外下雪。' }
  });
  expect(host.snapshot().approvals).toEqual([]);
});

it('默认读取完整正文，范围可读取至末尾，整篇覆盖允许清空正文', async () => {
  expect((await call('work_read', { workId, entryId: documentId })).result.structuredContent).toMatchObject({
    ok: true,
    value: { content: '将军守城。\n城外下雪。\n斥候回营。' }
  });
  expect((await call('work_read', { workId, entryId: documentId, offset: 3 })).result.structuredContent).toMatchObject({
    ok: true,
    value: { content: '斥候回营。' }
  });
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '' })).isError
  ).toBe(false);
  expect((await call('work_read', { workId, entryId: documentId })).result.structuredContent).toMatchObject({
    ok: true,
    value: { content: '', wordCount: 0 }
  });
});

it('精确编辑进入本会话候选，读取与其他会话、正式稿保持隔离，并拒绝陈旧修订', async () => {
  const input = { workId, entryId: documentId, expectedRevisionId: revisionId, oldText: '守城', newText: '出城' };
  const edited = await call('work_edit', input);
  expect(edited.isError).toBe(false);
  expect(edited.result.structuredContent).toMatchObject({
    ok: true,
    value: { kind: 'pending', entry: { workId, entryId: documentId } }
  });
  expect(read().content).toBe('将军守城。\n城外下雪。\n斥候回营。');
  const own = await call('work_read', { workId, entryId: documentId });
  expect(own.result.structuredContent).toMatchObject({
    ok: true,
    value: { content: '将军出城。\n城外下雪。\n斥候回营。' }
  });
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' } }
  })) as string;
  const outside = await call('work_read', { workId, entryId: documentId }, randomUUID(), undefined, other);
  expect(outside.result.structuredContent).toMatchObject({ ok: true, value: { content: read().content } });
  const stale = await call('work_edit', { ...input, oldText: '出城', newText: '回城' });
  expect(stale.isError).toBe(true);
  expect(stale.result.structuredContent).toMatchObject({ ok: false, error: { code: 'revision-conflict' } });
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
    ok: true,
    value: { kind: 'saved', entry: { workId, entryId: resource.id, format: 'markdown' } }
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

it('创建候选目录并移动、改名文稿，条目身份保持稳定，重复移动校验原位置', async () => {
  const directory = await call('work_mkdir', { workId, parentId: null, title: '第一卷', section: 'manuscript' });
  expect(directory.isError).toBe(false);
  const folder = pending().find(change => change.candidate.kind === 'directory')!.candidate;
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
  expect(inside.result.structuredContent).toMatchObject({
    ok: true,
    value: [{ entryId: documentId, parentId: folder.id, position: 0 }]
  });
  const renamed = await call('work_mv', {
    workId,
    entryId: documentId,
    expectedRevisionId: pending().find(change => change.entryId === documentId)!.version,
    title: '第一章'
  });
  expect(renamed.isError).toBe(false);
  expect(renamed.result.structuredContent).toMatchObject({
    ok: true,
    value: { entry: { entryId: documentId, parentId: folder.id, title: '第一章' } }
  });
  const stale = await call('work_mv', move);
  expect(stale.isError).toBe(true);
  expect(stale.result.structuredContent).toMatchObject({ ok: false, error: { code: 'entry-location-conflict' } });
  expect(read()).toMatchObject({ id: documentId, parentId: null, title: '序章' });
  expect((await call('work_ls', { workId, entryId: documentId })).isError).toBe(true);
});

it('按 glob 查找条目名称，包含候选改名及同名资料，并可限定分区', async () => {
  expect(
    (
      await call('work_write', {
        workId,
        parentId: null,
        title: '序章',
        section: 'resource',
        format: 'markdown',
        content: '人物资料'
      })
    ).isError
  ).toBe(false);
  const found = await call('work_find', { workId, pattern: '序?' });
  expect(found.isError).toBe(false);
  expect(found.result.structuredContent).toMatchObject({
    ok: true,
    value: [
      { workId, entryId: documentId, title: '序章', section: 'manuscript' },
      { title: '序章', section: 'resource' }
    ]
  });
  expect(
    (await call('work_mv', { workId, entryId: documentId, expectedRevisionId: revisionId, title: '第一章' })).isError
  ).toBe(false);
  const renamed = await call('work_find', { workId, pattern: '第*章', section: 'manuscript' });
  expect(renamed.result.structuredContent).toMatchObject({
    ok: true,
    value: [{ entryId: documentId, title: '第一章' }]
  });
  const absent = await call('work_find', { workId, pattern: '第*章', section: 'resource' });
  expect(absent.result.structuredContent).toEqual({ ok: true, value: [] });
});

it('按正则逐行查找本会话正文，返回行号和稳定身份，报告无效正则', async () => {
  expect(
    (
      await call('work_edit', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        oldText: '守城',
        newText: '出城'
      })
    ).isError
  ).toBe(false);
  const matches = await call('work_grep', { workId, pattern: '^将军(出城|巡营)' });
  expect(matches.isError).toBe(false);
  expect(matches.result.structuredContent).toEqual({
    ok: true,
    value: [
      { workId, entryId: documentId, revisionId: pending()[0].version, title: '序章', line: 1, text: '将军出城。' }
    ]
  });
  expect((await call('work_grep', { workId, pattern: '守城' })).result.structuredContent).toEqual({
    ok: true,
    value: []
  });
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' } }
  })) as string;
  const outside = await call('work_grep', { workId, pattern: '守城' }, randomUUID(), undefined, other);
  expect(outside.result.structuredContent).toMatchObject({
    ok: true,
    value: [{ entryId: documentId, text: '将军守城。' }]
  });
  const invalid = await call('work_grep', { workId, pattern: '[' });
  expect(invalid.isError).toBe(true);
  expect(invalid.result.structuredContent).toMatchObject({
    ok: false,
    error: { code: 'invalid-request', message: '正则表达式无效' }
  });
});

it('中文全文检索使用本会话候选并保留分页与分区，其他会话仍检索正式稿', async () => {
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '将军前往长安。'
      })
    ).isError
  ).toBe(false);
  const found = await call('work_search', { workId, query: '长安', offset: 0, limit: 1, section: 'manuscript' });
  expect(found.isError).toBe(false);
  expect(found.result.structuredContent).toMatchObject({
    ok: true,
    value: { entries: [{ workId, entryId: documentId, revisionId: pending()[0].version }], hasMore: false }
  });
  expect((await call('work_search', { workId, query: '长安', offset: 1, limit: 1 })).result.structuredContent).toEqual({
    ok: true,
    value: { entries: [], hasMore: false }
  });
  expect(
    (await call('work_search', { workId, query: '长安', offset: 0, limit: 1, section: 'resource' })).result
      .structuredContent
  ).toEqual({ ok: true, value: { entries: [], hasMore: false } });
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' } }
  })) as string;
  expect(
    (await call('work_search', { workId, query: '长安', offset: 0, limit: 1 }, randomUUID(), undefined, other)).result
      .structuredContent
  ).toEqual({ ok: true, value: { entries: [], hasMore: false } });
  expect(
    (await call('work_search', { workId, query: '将军', offset: 0, limit: 1 }, randomUUID(), undefined, other)).result
      .structuredContent
  ).toMatchObject({ ok: true, value: { entries: [{ entryId: documentId, revisionId }] } });
});

it('讨论模式实际阻止各类作品写入并保留读取，切回审阅后写入候选', async () => {
  await host.execute({ method: 'mode', input: { id, mode: 'discuss' } });
  const writes: Array<[string, Parameters<typeof runToolCall>[0]['arguments']]> = [
    ['work_edit', { workId, entryId: documentId, expectedRevisionId: revisionId, oldText: '守城', newText: '出城' }],
    ['work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '改稿' }],
    ['work_write', { workId, parentId: null, title: '新文稿', section: 'manuscript', format: 'txt', content: '' }],
    ['work_mkdir', { workId, parentId: null, title: '新目录', section: 'manuscript' }],
    ['work_mv', { workId, entryId: documentId, expectedRevisionId: revisionId, title: '新名称' }],
    [
      'work_mv',
      { workId, entryId: documentId, expectedParentId: null, expectedPosition: 0, parentId: null, beforeEntryId: null }
    ]
  ];
  for (const [name, input] of writes) expect((await call(name, input)).isError).toBe(true);
  expect((await call('work_read', { workId, entryId: documentId })).isError).toBe(false);
  expect(read().revisionId).toBe(revisionId);
  expect(pending()).toEqual([]);
  await host.execute({ method: 'mode', input: { id, mode: 'review' } });
  expect((await call(writes[0][0], writes[0][1])).isError).toBe(false);
  expect(pending()).toHaveLength(1);
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
  expect(pending()[0]).toMatchObject({ sessionId: id, entryId: documentId });
  expect(pending('forged-session')).toEqual([]);
  const retry = await call('work_edit', input, callId);
  expect(retry.isError).toBe(false);
  expect(retry.result.structuredContent).toEqual(first.result.structuredContent);
  expect(pending()).toHaveLength(1);
});

it('缺少定位或修订、无效范围和检索参数经 SDK 校验失败，作品保持原状', async () => {
  const invalid: Array<[string, Parameters<typeof runToolCall>[0]['arguments']]> = [
    ['work_ls', {}],
    ['work_ls', { workId }],
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
        entryId: candidate.entryId,
        expectedRevisionId: candidate.version,
        content: '后续内容'
      })
    ).isError
  ).toBe(false);
  const retry = await call('work_write', input, callId);
  expect(retry.isError).toBe(false);
  expect(retry.result.structuredContent).toEqual(first.result.structuredContent);
  expect(pending()).toHaveLength(1);
  expect(pending()[0].candidate).toMatchObject({ id: candidate.entryId, content: '后续内容' });
});
