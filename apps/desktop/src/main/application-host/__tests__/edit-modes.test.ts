import { runToolCall } from '@earendil-works/pi-agent-core';
import { defineTool } from '@earendil-works/pi-coding-agent';
import { readFile } from 'node:fs/promises';
import { Type } from 'typebox';
import { expect, it } from 'vitest';

import { modeEntryType } from '@chaptale/agent-host/protocol';
import type { EntrySnapshot } from '@chaptale/creation/contracts';

import {
  setupWorkSession,
  host,
  id,
  workId,
  documentId,
  revisionId,
  call,
  restartWithTools,
  deferredTools,
  read,
  pending,
  observeRequests,
  finishToolTurn,
  useSession
} from './work-session-fixture';

setupWorkSession();

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
  expect(readResult.result.structuredContent).toMatchObject({ content: read().content });
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
  useSession(
    (await host.execute({
      method: 'create',
      input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
    })) as string
  );
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
  useSession((await host.execute({ method: 'open', input: { file } })) as string);
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
  useSession((await host.execute({ method: 'open', input: history })) as string);
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
  useSession((await host.execute({ method: 'open', input: history })) as string);
  expect(host.snapshot().sessions.find(item => item.id === id)!.readonly).toMatchObject({ reason: 'damaged' });
  expect(host.liveSession(id)).toBeUndefined();
  await expect(host.execute({ method: 'prompt', input: { id, text: '继续' } })).rejects.toThrow('只读历史');
  expect(await readFile(history.file, 'utf8')).toBe(original);
});
