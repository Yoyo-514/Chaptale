import { runToolCall } from '@earendil-works/pi-agent-core';
import { defineTool, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Type } from 'typebox';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { builtinWritingInstructions, createHostModelRuntime, HostModelConfiguration } from '@chaptale/agent-host';
import { createHostApplication, HostApplication } from '@chaptale/agent-host/application';
import { modeEntryType } from '@chaptale/agent-host/protocol';
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

async function restartWithTools(tools: ToolDefinition[], history?: { file: string; cwd: string }) {
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
          input: { model: { provider: 'offline-tools', id: 'offline' } }
        }
  )) as string;
  return runtime;
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
  expect(result.result.structuredContent).toMatchObject({ ok: false });
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
  expect((await restored).isError).toBe(false);
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
  ).toEqual(reads);
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
    input: { model: { provider: 'offline-tools', id: 'offline' } }
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
  ).toEqual(reads);
  expect(existing.getActiveToolNames()).toContain('work_write');

  session.sessionManager.appendMessage({ role: 'user', content: '查阅长夜行的序章', timestamp: Date.now() });
  const file = session.sessionFile!;
  const cwd = session.sessionManager.getCwd();
  await host.execute({ method: 'close', input: { id } });
  await host.execute({ method: 'defaultMode', input: { mode: 'direct' } });
  id = (await host.execute({ method: 'open', input: { file, cwd } })) as string;
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
  ).toEqual(reads);
  expect((await call('work_read', { workId, entryId: documentId })).isError).toBe(false);

  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  const enabled = [...reads, 'work_edit', 'work_write', 'work_mkdir', 'work_mv'].sort();
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
  ).toEqual(enabled);
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
  ).toEqual(reads);
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
  const enabled = [...reads, 'work_edit', 'work_write', 'work_mkdir', 'work_mv'].sort();
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
  ).toEqual(enabled);
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

async function observeContinuation(runtime: Awaited<ReturnType<typeof restartWithTools>>) {
  const requests: Array<{ messages: string; tools: string[] }> = [];
  runtime.registerProvider('offline-tools', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-test-only',
    api: 'offline-delivery',
    models: [
      {
        id: 'offline',
        name: '离线继续检查',
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
      throw new Error('离线继续请求检查结束');
    }
  });
  await host.execute({ method: 'model', input: { id, model: { provider: 'offline-tools', id: 'offline' } } });
  return requests;
}

function decidePending(decision: 'accept' | 'reject') {
  const review = value(creation.executeAuthor({ method: 'readReview', input: { changeId: pending()[0].id } }));
  value(
    creation.executeAuthor({
      method: 'decideReview',
      input: {
        commandId: randomUUID(),
        changeId: review.change.id,
        expectedVersion: review.change.version,
        expectedRevisionId: review.current!.revisionId,
        expectedLocation: { parentId: review.current!.parentId, position: review.current!.position },
        decision
      }
    })
  );
}

it('改稿自动待审，作者处理后直接继续，延后的直接修改生效并发送正式内容', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeContinuation(runtime);
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '待审正文' }))
      .isError
  ).toBe(false);
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  await expect.poll(() => view().delivery?.pendingCount).toBe(1);
  const group = view().delivery!.group;
  expect(group.status).toBe('pending');
  expect(view().running).toBe(false);
  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  expect(view()).toMatchObject({ mode: 'review', switchingTo: 'direct' });
  const command = {
    method: 'continueReview' as const,
    input: {
      id,
      commandId: randomUUID(),
      groupId: group.id,
      expectedVersion: group.version
    }
  };
  await expect(host.execute(command)).rejects.toThrow('剩余修改');
  expect(requests).toHaveLength(0);
  decidePending('reject');
  expect(view().mode).toBe('review');
  await host.execute(command);
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => view().running).toBe(false);
  expect(requests[0].messages).toContain('实际接受后的正式内容');
  expect(requests[0].messages).toContain('将军守城');
  expect(requests[0].messages).not.toContain('待审正文');
  expect(view().mode).toBe('direct');
  expect(view().switchingTo).toBeUndefined();
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: read().revisionId,
        content: '直接保存'
      })
    ).isError
  ).toBe(false);
  expect(read().content).toBe('直接保存');
  expect(pending()).toEqual([]);
});

it('重启恢复待审与切换进度，继续通过原生请求发送正式快照且重复决定不重复发送', async () => {
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
  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  const session = host.liveSession(id)!;
  session.sessionManager.appendMessage({ role: 'user', content: '连续写三章', timestamp: Date.now() });
  const history = { file: session.sessionFile!, cwd: session.sessionManager.getCwd() };
  await host.execute({ method: 'close', input: { id } });
  creation.close();
  creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  const runtime = await restartWithTools([], history);
  const requests = await observeContinuation(runtime);
  const view = () => host.snapshot().sessions.find(item => item.id === id)!;
  expect(view()).toMatchObject({
    mode: 'review',
    switchingTo: 'direct',
    delivery: { pendingCount: 1, group: { status: 'pending' } }
  });
  expect(requests).toHaveLength(0);
  const group = view().delivery!.group;
  decidePending('accept');
  const command = {
    method: 'continueReview' as const,
    input: { id, commandId: randomUUID(), groupId: group.id, expectedVersion: group.version }
  };
  await host.execute(command);
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => view().running).toBe(false);
  expect(requests[0].messages).toContain('实际接受后的正式内容');
  expect(requests[0].messages).toContain('实际接受的正文');
  expect(requests[0].tools).toContain('work_write');
  expect(requests[0].tools.filter(name => name.startsWith('work_'))).toHaveLength(9);
  expect(view().mode).toBe('direct');
  expect(view().switchingTo).toBeUndefined();
  await host.execute(command);
  expect(requests).toHaveLength(1);
  await host.execute({ method: 'close', input: { id } });
  id = (await host.execute({ method: 'open', input: history })) as string;
  expect(view().mode).toBe('direct');
  expect(view().switchingTo).toBeUndefined();
});

it.each(['discuss', 'review'] as const)('撤回延后的直接修改到 %s，重开仍保持所选模式及待审内容', async mode => {
  expect(
    (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '待审正文' }))
      .isError
  ).toBe(false);
  await host.execute({ method: 'mode', input: { id, mode: 'direct' } });
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  expect(view().switchingTo).toBe('direct');
  await host.execute({ method: 'mode', input: { id, mode } });
  expect(view().mode).toBe(mode);
  expect(view().switchingTo).toBeUndefined();
  const session = host.liveSession(id)!;
  session.sessionManager.appendMessage({ role: 'user', content: '稍后再处理这些修改', timestamp: Date.now() });
  const history = { file: session.sessionFile!, cwd: session.sessionManager.getCwd() };
  await host.execute({ method: 'close', input: { id } });
  id = (await host.execute({ method: 'open', input: history })) as string;
  expect(view().mode).toBe(mode);
  expect(view().switchingTo).toBeUndefined();
  expect(pending()[0].candidate.content).toBe('待审正文');
  expect(read().revisionId).toBe(revisionId);
});

it.each(['空身份', '错误类型', '错误模式', '缺少分组', '其他会话'] as const)(
  '延后切换历史的%s只读打开并保留原文件',
  async fault => {
    expect(
      (await call('work_write', { workId, entryId: documentId, expectedRevisionId: revisionId, content: '待审正文' }))
        .isError
    ).toBe(false);
    const group = value(creation.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: id } }))!.group;
    if (fault === '其他会话')
      id = (await host.execute({
        method: 'create',
        input: { model: { provider: 'offline-tools', id: 'offline' } }
      })) as string;
    const session = host.liveSession(id)!;
    session.sessionManager.appendCustomEntry(modeEntryType, {
      mode: fault === '错误模式' ? 'direct' : 'review',
      directAfterGroupId:
        fault === '空身份' ? ' ' : fault === '错误类型' ? 17 : fault === '缺少分组' ? randomUUID() : group.id
    });
    session.sessionManager.appendMessage({ role: 'user', content: '检查历史记录', timestamp: Date.now() });
    const history = { file: session.sessionFile!, cwd: session.sessionManager.getCwd() };
    await host.execute({ method: 'close', input: { id } });
    const original = await readFile(history.file, 'utf8');
    id = (await host.execute({ method: 'open', input: history })) as string;
    const view = host.snapshot().sessions.find(item => item.id === id)!;
    expect(view.readonly).toMatchObject({ reason: 'damaged' });
    expect(host.liveSession(id)).toBeUndefined();
    await expect(host.execute({ method: 'prompt', input: { id, text: '继续' } })).rejects.toThrow('只读历史');
    expect(await readFile(history.file, 'utf8')).toBe(original);
  }
);
