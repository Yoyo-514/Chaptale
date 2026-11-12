import { runToolCall } from '@earendil-works/pi-agent-core';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Type } from 'typebox';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { builtinWritingInstructions, createHostModelRuntime, HostModelConfiguration } from '@chaptale/agent-host';
import { createHostApplication, HostApplication } from '@chaptale/agent-host/application';
import { type HistoryItem, modeEntryType, reviewResultsMessageType } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, EntrySnapshot, WorkReplacement } from '@chaptale/creation/contracts';
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
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
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

// 固定工具协议输入写入 SDK 公共消息状态，供嵌套调用定位发起者；不请求模型。
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
  session.agent.state.messages = [...session.agent.state.messages, assistant];
  return runToolCall(assistant.content[0], {
    assistantMessage: assistant,
    context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
    tools: session.agent.state.tools,
    beforeToolCall: session.agent.beforeToolCall,
    afterToolCall: session.agent.afterToolCall,
    signal
  });
}

async function restartWithTools(tools: ToolDefinition[], history?: { file: string }) {
  await host.dispose();
  const configDir = join(root, 'config');
  const runtime = await createHostModelRuntime({ configDir });
  host = await HostApplication.create({
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(configDir, 'settings.json'),
    builtinInstructions: builtinWritingInstructions,
    modelRuntime: runtime,
    modelConfiguration: new HostModelConfiguration(configDir, runtime),
    creation,
    tools: () => tools
  });
  id = (await host.execute(
    history
      ? { method: 'open', input: history }
      : {
          method: 'create',
          input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
        }
  )) as string;
  return runtime;
}

// 事件与关系工具由 tool_search 按需加载；pi 让延迟工具始终可经嵌套调用，讨论模式由宿主授权拒绝写入。
const deferredTools = ['work_record_ls', 'work_record_write', 'work_relation_ls', 'work_relation_write'];

async function load(query: string, sessionId = id) {
  const outcome = await call('tool_search', { query }, randomUUID(), undefined, sessionId);
  expect(outcome.isError, JSON.stringify(outcome.result)).toBe(false);
}

function read() {
  return value(creation.executeAuthor({ method: 'readDocument', input: { workId, documentId } }));
}

function pending(sessionId = id) {
  return value(creation.executeAuthor({ method: 'listPendingChanges', input: { workId, sessionId } }));
}

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
  expect(listed.result.structuredContent).toMatchObject({
    ok: true,
    value: [
      { entryId: image!.id, kind: 'file', title: '地图.png', file: { image: true, size: png.length } },
      { entryId: pdf!.id, kind: 'file', title: '设定.pdf', file: { image: false, size: 3 } }
    ]
  });
  const path = (listed.result.structuredContent as { value: { file: { path: string } }[] }).value[1]!.file.path;
  const imageRead = await call('work_read', { workId, entryId: image!.id });
  expect(imageRead.isError).toBe(false);
  expect(imageRead.result.content).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ type: 'text', text: expect.stringContaining('Read image file') })
    ])
  );
  const other = await call('work_read', { workId, entryId: pdf!.id });
  expect(other.isError).toBe(true);
  expect(other.result.structuredContent).toMatchObject({
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
  const read = await call('work_read', { workId, entryId: chapter.id });
  expect(read.result.structuredContent).toMatchObject({
    ok: true,
    value: { content: '开头。\n[插图：城门 entry:img-1]\n结尾。' }
  });
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
  expect(created.result.structuredContent).toMatchObject({
    ok: false,
    error: { message: '不能新建插图，只能保留或移动正文中已有的插图' }
  });
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
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
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
    ok: true,
    value: {
      pending: true,
      content: '守城的将军。',
      attributes: { type: '人物', aliases: ['小沈'], tags: [], cover: null }
    }
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
  expect(inside.result.structuredContent).toMatchObject({
    ok: true,
    value: [{ entryId: documentId, parentId: folder.id, position: 0 }]
  });
  const renamed = await call('work_mv', {
    workId,
    entryId: documentId,
    expectedRevisionId: pending().find(change => change.targetId === documentId)!.version,
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

it('按资料类型查找规划资料', async () => {
  for (const [title, type] of [
    ['长夜大纲', '规划'],
    ['顾长风', '人物']
  ]) {
    const entry = value(
      creation.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId,
          parentId: null,
          section: 'resource',
          kind: 'document',
          title: title!,
          format: 'txt',
          content: ''
        }
      })
    );
    value(
      creation.executeAuthor({
        method: 'saveDocument',
        input: {
          commandId: randomUUID(),
          workId,
          documentId: entry.id,
          expectedRevisionId: entry.revisionId,
          title: title!,
          format: 'txt',
          content: '',
          attributes: { type: type!, aliases: [], tags: [], cover: null }
        }
      })
    );
  }
  const found = await call('work_find', { workId, pattern: '*', type: '规划' });
  expect(found.result.structuredContent).toMatchObject({ ok: true, value: [{ title: '长夜大纲' }] });
  expect((found.result.structuredContent as { value: unknown[] }).value).toHaveLength(1);
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
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
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
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
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

it('切到讨论时，已经取得旧工具集合的写调用仍按执行时模式拒绝', async () => {
  const writing = call('work_write', {
    workId,
    entryId: documentId,
    expectedRevisionId: revisionId,
    content: '迟到的改稿'
  });
  await host.execute({ method: 'mode', input: { id, mode: 'discuss' } });
  const result = await writing;
  expect(result.isError).toBe(true);
  expect(result.result.content).toEqual([{ type: 'text', text: '当前为讨论模式，作品只读' }]);
  expect(read().revisionId).toBe(revisionId);
  expect(pending()).toEqual([]);
});

it('运行中的父工具按切换后的 callable 集合嵌套调用，讨论可读，恢复审阅后可写', async () => {
  const entered = Promise.withResolvers<void>();
  const resume = Promise.withResolvers<void>();
  const parent = defineTool({
    name: 'nested_work',
    label: '嵌套作品调用',
    description: '经真实 SDK 上下文调用作品工具。',
    parameters: Type.Object({ tool: Type.Union([Type.Literal('work_read'), Type.Literal('work_write')]) }),
    async execute(_callId, input, signal, _onUpdate, ctx) {
      entered.resolve();
      await resume.promise;
      signal?.throwIfAborted();
      const result = await ctx.executeTool(
        input.tool,
        input.tool === 'work_read'
          ? { workId, entryId: documentId }
          : { workId, entryId: documentId, expectedRevisionId: revisionId, content: '嵌套改稿' }
      );
      return { ...result.result, isError: result.isError };
    }
  });
  await restartWithTools([parent]);
  async function approve() {
    await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
    const request = host.snapshot().approvals[0];
    expect(request.toolName).toBe('nested_work');
    await host.execute({ method: 'approve', input: { id: request.id, allow: true } });
  }

  const writing = call('nested_work', { tool: 'work_write' });
  await approve();
  await entered.promise;
  await host.execute({ method: 'mode', input: { id, mode: 'discuss' } });
  resume.resolve();
  expect((await writing).isError).toBe(true);
  const session = host.liveSession(id)!;
  expect(session.getActiveToolNames()).not.toContain('work_write');
  expect(session.getCallableToolNames()).not.toContain('work_write');
  expect(read().revisionId).toBe(revisionId);
  expect(pending()).toEqual([]);

  const reading = call('nested_work', { tool: 'work_read' });
  await approve();
  const readResult = await reading;
  expect(readResult.isError, JSON.stringify(readResult.result)).toBe(false);
  expect(readResult.result.structuredContent).toMatchObject({ ok: true, value: { content: read().content } });
  await host.execute({ method: 'mode', input: { id, mode: 'review' } });
  const restored = call('nested_work', { tool: 'work_write' });
  await approve();
  const restoredResult = await restored;
  expect(restoredResult.isError).toBe(false);
  expect(await finishToolTurn(restoredResult)).toBeUndefined();
  expect(pending()).toMatchObject([{ sessionId: id, candidate: { content: '嵌套改稿' } }]);
  expect(read().revisionId).toBe(revisionId);
});

it('讨论模式修改指令重载后，模型请求仍只有作品读工具', async () => {
  const runtime = await restartWithTools([]);
  let declared: string[] | undefined;
  runtime.registerProvider('offline-tools', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-test-only',
    api: 'offline-tool-loadout',
    models: [
      {
        id: 'offline',
        name: '离线工具声明检查',
        contextWindow: 8192,
        maxTokens: 128,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    // 只观察 SDK 首次请求中的工具声明并在传输边界结束，不联网或生成模型回复。
    streamSimple: (_model, context) => {
      declared = context.messages.flatMap(message =>
        message.role === 'system' ? (message.toolsAdded ?? []).map(tool => tool.name) : []
      );
      throw new Error('离线工具声明检查结束');
    }
  });
  await host.execute({ method: 'model', input: { id, model: { provider: 'offline-tools', id: 'offline' } } });
  await host.execute({ method: 'mode', input: { id, mode: 'discuss' } });
  await host.execute({
    method: 'instructions',
    input: { id, entries: [{ name: '主创', role: 'system', text: '查阅作品并讨论，不改写作品。', enabled: true }] }
  });
  await host.execute({ method: 'prompt', input: { id, text: '查阅序章' } });
  await expect.poll(() => host.snapshot().sessions.find(view => view.id === id)?.running).toBe(false);
  const reads = ['work_find', 'work_grep', 'work_ls', 'work_read', 'work_search'];
  expect(declared?.filter(name => name.startsWith('work_')).sort()).toEqual(reads);
  const session = host.liveSession(id)!;
  expect(
    session
      .getActiveToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual(reads);
  expect(
    session
      .getCallableToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual([...reads, ...deferredTools].sort());
  expect(session.agent.state.messages.at(-1)).toMatchObject({
    stopReason: 'error',
    errorMessage: '离线工具声明检查结束'
  });
  expect(read().revisionId).toBe(revisionId);
  expect(pending()).toEqual([]);
});

it('讨论模式的新会话与历史重开保持只读工具集合，切回直接修改后生成正式修订', async () => {
  const existing = host.liveSession(id)!;
  await host.execute({ method: 'defaultMode', input: { mode: 'discuss' } });
  id = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  const session = host.liveSession(id)!;
  const reads = ['work_find', 'work_grep', 'work_ls', 'work_read', 'work_search'];
  expect(
    session
      .getActiveToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual(reads);
  expect(
    session
      .getCallableToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual([...reads, ...deferredTools].sort());
  expect(existing.getActiveToolNames()).toContain('work_write');

  session.sessionManager.appendMessage({ role: 'user', content: '查阅长夜行的序章', timestamp: Date.now() });
  const file = session.sessionFile!;
  await host.execute({ method: 'close', input: { id } });
  await host.execute({ method: 'defaultMode', input: { mode: 'direct' } });
  id = (await host.execute({ method: 'open', input: { file } })) as string;
  const reopened = host.liveSession(id)!;
  expect(host.snapshot().sessions.find(view => view.id === id)?.mode).toBe('discuss');
  expect(
    reopened
      .getActiveToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual(reads);
  expect(
    reopened
      .getCallableToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual([...reads, ...deferredTools].sort());
  expect((await call('work_read', { workId, entryId: documentId })).isError).toBe(false);

  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  const enabled = [...reads, 'work_edit', 'work_write', 'work_mkdir', 'work_mv', 'work_rm'].sort();
  expect(
    reopened
      .getActiveToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual(enabled);
  expect(
    reopened
      .getCallableToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual([...enabled, ...deferredTools].sort());
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '正式改稿' }))
      .isError
  ).toBe(false);
  expect(read().content).toBe('正式改稿');
  expect(pending()).toEqual([]);
});

it('讨论模式移除可见及可调用的作品写工具，保留读取与文件工具，切回审阅后写入候选', async () => {
  const session = host.liveSession(id)!;
  const fileTools = session.getActiveToolNames().filter(name => !name.startsWith('work_'));
  await host.execute({ method: 'mode', input: { id, mode: 'discuss' } });
  const reads = ['work_find', 'work_grep', 'work_ls', 'work_read', 'work_search'];
  expect(
    session
      .getActiveToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual(reads);
  expect(
    session
      .getCallableToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual([...reads, ...deferredTools].sort());
  expect(session.getActiveToolNames().filter(name => !name.startsWith('work_'))).toEqual(fileTools);
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
  const enabled = [...reads, 'work_edit', 'work_write', 'work_mkdir', 'work_mv', 'work_rm'].sort();
  expect(
    session
      .getActiveToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual(enabled);
  expect(
    session
      .getCallableToolNames()
      .filter(name => name.startsWith('work_'))
      .sort()
  ).toEqual([...enabled, ...deferredTools].sort());
  expect(session.getActiveToolNames().filter(name => !name.startsWith('work_'))).toEqual(fileTools);
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

/** 把当前会话换成归属作品的新会话，会话历史写在作品的会话目录。 */
async function ownSession() {
  await host.execute({ method: 'close', input: { id } });
  id = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId }
  })) as string;
}

async function observeRequests(runtime: Awaited<ReturnType<typeof restartWithTools>>) {
  const requests: Array<{ messages: string; tools: string[] }> = [];
  runtime.registerProvider('offline-tools', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-test-only',
    api: 'offline-review-results',
    models: [
      {
        id: 'offline',
        name: '离线请求观察',
        contextWindow: 8192,
        maxTokens: 128,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    // 在传输边界观察请求后结束；不联网、不生成模型回复。
    streamSimple: (_model, context) => {
      requests.push({
        messages: JSON.stringify(context.messages),
        tools: context.messages.flatMap(message =>
          message.role === 'system' ? (message.toolsAdded ?? []).map(tool => tool.name) : []
        )
      });
      throw new Error('离线传输检查结束');
    }
  });
  await host.execute({ method: 'model', input: { id, model: { provider: 'offline-tools', id: 'offline' } } });
  return requests;
}

function decidePending(decision: 'accept' | 'reject', changeId = pending()[0].id) {
  const review = value(creation.executeAuthor({ method: 'readReview', input: { changeId } }));
  const command = {
    method: 'decideReview' as const,
    input: {
      commandId: randomUUID(),
      changeId,
      expectedVersion: review.change.version,
      expectedRevisionId: review.current?.revisionId ?? null,
      expectedLocation:
        review.change.target === 'entry' && review.current
          ? {
              parentId: (review.current as EntrySnapshot).parentId,
              position: (review.current as EntrySnapshot).position
            }
          : null,
      decision
    }
  };
  value(creation.executeAuthor(command));
  return command;
}

// 将公共工具管线的真实结果交给 SDK 原生回合边界；固定协议夹具不生成模型回复。
async function finishToolTurn(outcome: Awaited<ReturnType<typeof call>>) {
  const session = host.liveSession(id)!;
  const message = session.agent.state.messages.at(-1)!;
  if (message.role !== 'assistant') throw new Error('工具协议夹具缺少 assistant 消息');
  const result = {
    role: 'toolResult' as const,
    toolCallId: outcome.toolCall.id,
    toolName: outcome.toolCall.name,
    content: outcome.result.content,
    details: outcome.result.details,
    structuredContent: outcome.result.structuredContent,
    isError: outcome.isError,
    timestamp: Date.now()
  };
  session.sessionManager.appendMessage(message);
  session.sessionManager.appendMessage(result);
  session.agent.state.messages = [...session.agent.state.messages, result];
  return session.agent.finishTurn!({
    message,
    toolResults: [result],
    context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
    newMessages: [message, result]
  });
}

it('审阅写入不打断本轮，完成本次请求后停下并保留候选', async () => {
  await host.liveSession(id)!.reload();
  const writing = await call('work_write', {
    workId,
    entryId: documentId,
    expectedRevisionId: revisionId,
    content: '待审正文'
  });
  expect(writing.isError).toBe(false);
  expect(await finishToolTurn(writing)).toBeUndefined();
  expect(pending()).toHaveLength(1);
  expect(read().revisionId).toBe(revisionId);
  expect(host.snapshot().sessions.find(session => session.id === id)!.running).toBe(false);
});

it.each(['先停止', '决定后立即停止', '关闭会话'] as const)(
  '%s后作者决定保持空闲，下一条消息才交出结果',
  async timing => {
    const runtime = await restartWithTools([]);
    const requests = await observeRequests(runtime);
    expect(
      (
        await call('work_write', {
          workId,
          entryId: documentId,
          expectedRevisionId: revisionId,
          content: '实际接受的正文'
        })
      ).isError
    ).toBe(false);
    const session = host.liveSession(id)!;
    session.sessionManager.appendMessage({ role: 'user', content: '稍后继续写作', timestamp: Date.now() });
    const history = { file: session.sessionFile! };
    if (timing === '决定后立即停止') decidePending('accept');
    await host.execute({ method: timing === '关闭会话' ? 'close' : 'cancel', input: { id } });
    if (timing !== '决定后立即停止') decidePending('accept');
    expect(requests).toHaveLength(0);
    if (timing === '关闭会话') id = (await host.execute({ method: 'open', input: history })) as string;
    const view = () => host.snapshot().sessions.find(item => item.id === id)!;
    expect(view().running).toBe(false);
    await host.execute({ method: 'prompt', input: { id, text: '继续余下任务' } });
    await expect.poll(() => requests.length).toBe(1);
    await expect.poll(() => view().running).toBe(false);
    expect(requests[0].messages).toContain('实际接受的正文');
    expect(requests[0].messages.indexOf('作者已处理')).toBeLessThan(requests[0].messages.indexOf('继续余下任务'));
  }
);

it('已有候选时切到直接修改立即生效，原候选留待作者审阅', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '待审正文' }))
      .isError
  ).toBe(false);
  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  const view = host.snapshot().sessions.find(session => session.id === id)!;
  expect(view.mode).toBe('direct');
  expect(requests).toHaveLength(0);
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '直接保存' }))
      .isError
  ).toBe(false);
  expect(read().content).toBe('直接保存');
  expect(pending()).toHaveLength(1);
  expect((pending()[0].candidate as EntrySnapshot).content).toBe('待审正文');
});

it('部分正文已处理后随下一条消息送达，剩余候选继续待审；再次发送不重复插入结果', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '将军出城。\n城外下雪。\n斥候远行。'
      })
    ).isError
  ).toBe(false);
  const review = value(creation.executeAuthor({ method: 'readReview', input: { changeId: pending()[0].id } }));
  value(
    creation.executeAuthor({
      method: 'decideReview',
      input: {
        commandId: randomUUID(),
        changeId: review.change.id,
        expectedVersion: review.change.version,
        expectedRevisionId: review.current!.revisionId,
        expectedLocation: { parentId: null, position: 0 },
        decision: 'accept',
        range: { fromA: 0, toA: 5, fromB: 0, toB: 5 }
      }
    })
  );
  expect(requests).toHaveLength(0);
  expect(pending()).toHaveLength(1);
  await host.execute({ method: 'prompt', input: { id, text: '解释余下的修改' } });
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  await expect.poll(() => view().running).toBe(false);
  expect(requests).toHaveLength(1);
  expect(requests[0].messages).toContain('将军出城');
  expect(view().messages.filter(message => message.role === 'reviewResults')).toMatchObject([
    { text: '作者已处理 1 处修改' }
  ]);
  expect(pending()).toHaveLength(1);
  await host.execute({ method: 'prompt', input: { id, text: '再解释一下' } });
  await expect.poll(() => view().running).toBe(false);
  expect(requests).toHaveLength(2);
  expect(view().messages.filter(message => message.role === 'reviewResults')).toHaveLength(1);
});

it('拒绝片段与正式稿写入原生消息，界面只展示逐处摘要', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '被拒绝的候选正文'
      })
    ).isError
  ).toBe(false);
  decidePending('reject');
  expect(requests).toHaveLength(0);
  await host.execute({ method: 'prompt', input: { id, text: '请说明刚才的建议' } });
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  await expect.poll(() => view().running).toBe(false);
  expect(requests[0].messages).toContain('被拒绝的候选正文');
  expect(requests[0].messages).toContain('不要原样重做');
  expect(requests[0].messages).toContain('将军守城');
  const notices = view().messages.filter(message => message.role === 'reviewResults');
  expect(notices).toMatchObject([
    { text: '作者已处理 1 处修改', outcomes: [{ id: expect.any(String), text: '《序章》·正文已拒绝' }] }
  ]);
  expect(view().messages.some(message => message.text.includes('各处决定与原文'))).toBe(false);
});

it('自定义消息已写盘而本机送达进度失败，重开补进度并只保留一条结果消息', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '实际接受的正文'
      })
    ).isError
  ).toBe(false);
  decidePending('accept');
  const session = host.liveSession(id)!;
  session.sessionManager.appendMessage({ role: 'user', content: '先前任务', timestamp: Date.now() });
  const history = { file: session.sessionFile! };
  const fault = new DatabaseSync(join(root, 'creation', 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_reporting BEFORE UPDATE ON review_results BEGIN SELECT RAISE(ABORT, '送达进度故障'); END"
    );
    await host.execute({ method: 'prompt', input: { id, text: '继续任务' } });
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    expect(requests).toHaveLength(0);
    expect(
      session.sessionManager
        .getBranch()
        .filter(entry => entry.type === 'custom_message' && entry.customType === reviewResultsMessageType)
    ).toHaveLength(1);
    fault.exec('DROP TRIGGER fail_reporting');
    await host.execute({ method: 'close', input: { id } });
    id = (await host.execute({ method: 'open', input: history })) as string;
    await host.execute({ method: 'prompt', input: { id, text: '重新继续任务' } });
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    expect(requests).toHaveLength(1);
    expect(
      host
        .liveSession(id)!
        .sessionManager.getBranch()
        .filter(entry => entry.type === 'custom_message' && entry.customType === reviewResultsMessageType)
    ).toHaveLength(1);
    expect(value(creation.executeAuthor({ method: 'listReviewResults', input: { sessionId: id } }))).toEqual([]);
  } finally {
    fault.close();
  }
});

it('生成中插话使用SDK原生队列，结果在对应消息前入队，连续插话各自捕获快照', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '将军出城。\n城外下雪。\n斥候远行。'
      })
    ).isError
  ).toBe(false);
  const session = host.liveSession(id)!;
  const send = session.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  session.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  try {
    await host.execute({ method: 'prompt', input: { id, text: '解释原建议' } });
    await entered.promise;
    const change = pending()[0];
    const review = value(creation.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
    value(
      creation.executeAuthor({
        method: 'decideReview',
        input: {
          commandId: randomUUID(),
          changeId: change.id,
          expectedVersion: change.version,
          expectedRevisionId: review.current!.revisionId,
          expectedLocation: { parentId: null, position: 0 },
          decision: 'accept',
          range: { fromA: 0, toA: 5, fromB: 0, toB: 5 }
        }
      })
    );
    await host.execute({ method: 'prompt', input: { id, text: '第一条插话' } });
    decidePending('reject');
    await host.execute({ method: 'prompt', input: { id, text: '第二条插话' } });
    expect(session.getSteeringMessages()).toEqual(['第一条插话', '第二条插话']);
    release.resolve();
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    expect(requests).toHaveLength(3);
    const resultMessages = session.sessionManager
      .getBranch()
      .filter(entry => entry.type === 'custom_message' && entry.customType === reviewResultsMessageType);
    expect(resultMessages).toHaveLength(2);
    expect(
      resultMessages.map(entry => entry.type === 'custom_message' && (entry.details as { count: number }).count)
    ).toEqual([1, 1]);
    expect(JSON.stringify(resultMessages[0])).toContain('将军出城');
    expect(JSON.stringify(resultMessages[0])).not.toContain('斥候远行');
    expect(JSON.stringify(resultMessages[1])).toContain('斥候远行');
  } finally {
    release.resolve();
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    session.agent.streamFunction = send;
  }
});

it.each(['direct', 'discuss', 'review'] as const)('切换到%s立即生效，历史重开保持所选模式和待审候选', async mode => {
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '待审正文' }))
      .isError
  ).toBe(false);
  await host.execute({ method: 'mode', input: { id, mode } });
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  expect(view().mode).toBe(mode);
  const session = host.liveSession(id)!;
  session.sessionManager.appendMessage({ role: 'user', content: '稍后继续', timestamp: Date.now() });
  const history = { file: session.sessionFile! };
  await host.execute({ method: 'close', input: { id } });
  id = (await host.execute({ method: 'open', input: history })) as string;
  expect(view().mode).toBe(mode);
  expect(pending()).toHaveLength(1);
  expect(read().revisionId).toBe(revisionId);
});

it.each(['', 'unknown', 17] as const)('无效模式记录%s只读打开，原始历史保持原样', async mode => {
  const session = host.liveSession(id)!;
  session.sessionManager.appendCustomEntry(modeEntryType, { mode });
  session.sessionManager.appendMessage({ role: 'user', content: '检查历史记录', timestamp: Date.now() });
  const history = { file: session.sessionFile! };
  await host.execute({ method: 'close', input: { id } });
  const original = await readFile(history.file, 'utf8');
  id = (await host.execute({ method: 'open', input: history })) as string;
  expect(host.snapshot().sessions.find(item => item.id === id)!.readonly).toMatchObject({ reason: 'damaged' });
  expect(host.liveSession(id)).toBeUndefined();
  await expect(host.execute({ method: 'prompt', input: { id, text: '继续' } })).rejects.toThrow('只读历史');
  expect(await readFile(history.file, 'utf8')).toBe(original);
});

it('删除会话时拒绝其全部待审修改、清除查看位置、关闭会话，并返回待移入回收站的历史文件', async () => {
  const runtime = await restartWithTools([]);
  await observeRequests(runtime);
  const edited = await call('work_edit', {
    workId,
    entryId: documentId,
    expectedRevisionId: revisionId,
    oldText: '守城',
    newText: '出城'
  });
  expect(edited.isError).toBe(false);
  host.liveSession(id)!.sessionManager.appendMessage({ role: 'user', content: '改一下序章', timestamp: Date.now() });
  const sessionId = host.snapshot().sessions.find(item => item.id === id)!.sessionId!;
  id = (await host.execute({ method: 'assignSession', input: { sessionId, workId } })) as string;
  const file = host.liveSession(id)!.sessionFile!;
  expect(pending()).toHaveLength(1);

  // 运行中的会话整体拒绝删除，待审修改保持原状。
  const live = host.liveSession(id)!;
  const send = live.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  live.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '先别删' } });
  await entered.promise;
  await expect(host.execute({ method: 'deleteSessions', input: { sessionIds: [sessionId] } })).rejects.toThrow(
    '有会话正在运行'
  );
  expect(pending()).toHaveLength(1);
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);

  value(creation.executeAuthor({ method: 'selectSession', input: { sessionId, workId } }));

  const result = await host.execute({ method: 'deleteSessions', input: { sessionIds: [sessionId] } });

  expect(result).toEqual({ files: [file] });
  const state = value(creation.executeAuthor({ method: 'readSessionState', input: {} }));
  expect(state.selections).toContainEqual({ workId, sessionId: null });
  expect(pending()).toEqual([]);
  expect(host.snapshot().sessions.some(item => item.id === id)).toBe(false);
  expect(read().content).toBe('将军守城。\n城外下雪。\n斥候回营。');
});

it('删除作品时属于它的会话在运行则拒绝；停止后移入作品库回收站、关闭会话，历史仍在作品的会话目录', async () => {
  const runtime = await restartWithTools([]);
  await observeRequests(runtime);
  await ownSession();
  const edited = await call('work_edit', {
    workId,
    entryId: documentId,
    expectedRevisionId: revisionId,
    oldText: '守城',
    newText: '出城'
  });
  expect(edited.isError).toBe(false);
  const sessionId = host.snapshot().sessions.find(item => item.id === id)!.sessionId!;

  const live = host.liveSession(id)!;
  const send = live.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  live.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '继续' } });
  await entered.promise;
  const input = { commandId: randomUUID(), workId };
  await expect(host.execute({ method: 'trashWork', input })).rejects.toThrow('有会话正在运行');
  expect(pending()).toHaveLength(1);
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);

  await host.execute({ method: 'trashWork', input });

  expect(pending()).toEqual([]);
  expect(host.snapshot().sessions.some(item => item.id === id)).toBe(false);
  expect(value(creation.executeAuthor({ method: 'listTrashedWorks', input: {} })).map(work => work.id)).toEqual([
    workId
  ]);
  const items = (await host.execute({ method: 'history', input: undefined })) as HistoryItem[];
  expect(items.find(item => item.id === sessionId)?.workId).toBe(workId);
});

it('归入作品移动历史文件并重新打开；运行中拒绝，尚未写盘与已归属的会话不能归入', async () => {
  await observeRequests(await restartWithTools([]));
  const sessions = join(root, 'sessions');
  const draft = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  await expect(host.execute({ method: 'assignSession', input: { sessionId: draft, workId } })).rejects.toThrow(
    '会话还没有内容'
  );

  const session = host.liveSession(id)!;
  session.sessionManager.appendMessage({ role: 'user', content: '归入前的消息', timestamp: Date.now() });
  const sessionId = session.sessionId;
  const original = session.sessionFile!;
  const content = await readFile(original, 'utf8');
  expect(dirname(original)).toBe(join(sessions, 'unassigned'));

  const send = session.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  session.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '继续' } });
  await entered.promise;
  await expect(host.execute({ method: 'assignSession', input: { sessionId, workId } })).rejects.toThrow('会话正在运行');
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
  const settled = await readFile(original, 'utf8');
  expect(settled.startsWith(content)).toBe(true);

  const reopened = (await host.execute({ method: 'assignSession', input: { sessionId, workId } })) as string;
  const view = host.snapshot().sessions.find(item => item.id === reopened)!;
  expect(view).toMatchObject({ sessionId, workId, file: join(sessions, workId, basename(original)) });
  expect(host.snapshot().sessions.filter(item => item.sessionId === sessionId)).toHaveLength(1);
  expect(existsSync(original)).toBe(false);
  expect(await readFile(view.file, 'utf8')).toBe(settled);
  expect(host.liveSession(reopened)!.sessionManager.getCwd()).not.toBe(join(root, 'work'));
  await expect(host.execute({ method: 'assignSession', input: { sessionId, workId } })).rejects.toThrow('已归属作品');
});

it('永久删除作品时关闭其会话，作品目录与会话目录一并交给平台移入回收站', async () => {
  const sessionId = host.snapshot().sessions.find(item => item.id === id)!.sessionId!;
  host.liveSession(id)!.sessionManager.appendMessage({ role: 'user', content: '作品会话', timestamp: Date.now() });
  id = (await host.execute({ method: 'assignSession', input: { sessionId, workId } })) as string;
  await host.execute({ method: 'trashWork', input: { commandId: randomUUID(), workId } });
  const purged = (await host.execute({ method: 'purgeWork', input: { commandId: randomUUID(), workId } })) as {
    files: string[];
  };
  expect(purged.files.map(file => relative(root, file).replaceAll('\\', '/'))).toEqual(
    expect.arrayContaining([`creation/works/${workId}`, `sessions/${workId}`])
  );
  expect(purged.files).toHaveLength(2);
  expect(host.snapshot().sessions).toEqual([]);
  expect(value(creation.executeAuthor({ method: 'listTrashedWorks', input: {} }))).toEqual([]);
});

it('覆盖导入与恢复导入前版本：属于作品的会话在运行则拒绝；停止后替换内容并关闭会话', async () => {
  const runtime = await restartWithTools([]);
  await observeRequests(runtime);
  await ownSession();
  const path = join(await mkdtemp(join(tmpdir(), 'chaptale-package-')), '作品.chaptale');
  value(await creation.execute({ method: 'exportWorkPackage', input: { workId, path } }));

  const live = host.liveSession(id)!;
  const send = live.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  live.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '继续' } });
  await entered.promise;
  const input = { commandId: randomUUID(), path, asCopy: false };
  await expect(host.execute({ method: 'importWorkPackage', input })).rejects.toThrow(
    '有会话正在运行，停止后才能覆盖作品'
  );
  expect(value(await creation.execute({ method: 'listWorkSnapshots', input: {} }))).toEqual([]);
  const copy = (await host.execute({
    method: 'importWorkPackage',
    input: { ...input, commandId: randomUUID(), asCopy: true }
  })) as WorkReplacement;
  expect(copy.work.id).not.toBe(workId);
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);

  await host.execute({ method: 'importWorkPackage', input });
  expect(host.snapshot().sessions.some(item => item.id === id)).toBe(false);
  expect(value(await creation.execute({ method: 'listWorkSnapshots', input: {} })).map(item => item.workId)).toEqual([
    workId
  ]);
  const restored = (await host.execute({
    method: 'restoreWorkSnapshot',
    input: { commandId: randomUUID(), workId }
  })) as WorkReplacement;
  expect(restored.files).toHaveLength(1);
  expect(value(await creation.execute({ method: 'listWorkSnapshots', input: {} }))).toEqual([]);
});

function structured(outcome: Awaited<ReturnType<typeof call>>) {
  return outcome.result.structuredContent as CreationResult<Record<string, unknown>>;
}

async function createResource(title: string) {
  const outcome = await call('work_write', {
    workId,
    parentId: null,
    title,
    section: 'resource',
    format: 'markdown',
    content: ''
  });
  return (value(structured(outcome)).entry as { entryId: string }).entryId;
}

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

it('tool_search 加载的工具随历史重开保留，下一次请求不撤下', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  await load('work_record');
  await host.execute({ method: 'prompt', input: { id, text: '列出事件' } });
  await expect.poll(() => requests.length).toBe(1);
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  await expect.poll(() => view().running).toBe(false);
  const session = host.liveSession(id)!;
  const history = { file: session.sessionFile! };
  await host.execute({ method: 'close', input: { id } });
  id = (await host.execute({ method: 'open', input: history })) as string;
  expect(host.liveSession(id)!.getActiveToolNames()).toEqual(
    expect.arrayContaining(['work_record_ls', 'work_record_write'])
  );
  await host.execute({ method: 'prompt', input: { id, text: '再列一次' } });
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].messages).not.toContain('toolsRemoved');
});

it('归属作品的会话以作品文件目录为工作目录，目录内读取不逐次询问，目录外仍需作者授权', async () => {
  const owned = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId }
  })) as string;
  const session = host.liveSession(owned)!;
  const cwd = session.sessionManager.getCwd();
  expect(cwd).not.toBe(join(root, 'work'));
  await writeFile(join(cwd, '设定.txt'), '城外下雪');
  expect(session.systemPrompt).toContain(`本会话归属作品《长夜行》，作品 ID 为 ${workId}`);
  expect(dirname(session.sessionFile!)).toBe(join(root, 'sessions', workId));
  expect(host.snapshot().sessions.find(item => item.id === owned)?.workId).toBe(workId);
  await host.execute({ method: 'mode', input: { id: owned, mode: 'direct' } });

  const inside = await call('read', { path: '设定.txt' }, undefined, undefined, owned);
  expect(inside.isError).toBe(false);
  expect(JSON.stringify(inside.result.content)).toContain('城外下雪');
  expect(host.snapshot().approvals).toEqual([]);

  await writeFile(join(root, '目录外.txt'), '不应自动读取');
  const outside = call('read', { path: join(root, '目录外.txt') }, undefined, undefined, owned);
  await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
  await host.execute({ method: 'approve', input: { id: host.snapshot().approvals[0].id, allow: false } });
  expect((await outside).isError).toBe(true);
});
