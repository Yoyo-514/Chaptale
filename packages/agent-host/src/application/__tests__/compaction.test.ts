import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { instructionsEntryType, modeEntryType } from '../../protocol/index.ts';
import {
  setupHost,
  app,
  options,
  captured,
  model,
  capture,
  entry,
  builtin,
  zeroUsage,
  offlineModel,
  create,
  open,
  view,
  settled,
  history
} from './host-fixture.ts';

setupHost();

it('会话用量汇总压缩前后的原生记录，重开保持一致且会话之间隔离', async () => {
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, 'unassigned'));
  manager.appendModelChange(model.provider, model.id);
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  manager.appendMessage({ role: 'user', content: '早先的讨论', timestamp: Date.now() });
  manager.appendUsage('history', model.provider, model.id, {
    ...zeroUsage,
    input: 100,
    output: 20,
    cacheRead: 30,
    cacheWrite: 40,
    totalTokens: 190
  });
  const kept = manager.appendMessage({ role: 'user', content: '最近的要求', timestamp: Date.now() });
  manager.appendCompaction('历史总结', kept, 1200);
  manager.appendUsage('history', model.provider, model.id, { ...zeroUsage, input: 50, totalTokens: 50 });
  const input = { file: manager.getSessionFile()! };
  const id = await open(input);
  const expected = {
    input: 150,
    output: 20,
    cacheRead: 30,
    cacheWrite: 40,
    context: { tokens: null, contextWindow: 8192, percent: null }
  };
  expect(view(id).usage).toEqual(expected);
  expect(view(await create()).usage).toMatchObject({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });
  const snapshot = app.snapshot();
  snapshot.sessions.find(session => session.id === id)!.usage!.input = 999;
  expect(view(id).usage).toEqual(expected);
  await app.execute({ method: 'close', input: { id } });
  expect(view(await open(input)).usage).toEqual(expected);
});

it('压缩后的历史收到有效用量后恢复上下文估算，切换模型更新窗口', async () => {
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, 'unassigned'));
  manager.appendModelChange(model.provider, model.id);
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  const kept = manager.appendMessage({ role: 'user', content: '继续创作', timestamp: Date.now() });
  manager.appendCompaction('前文总结', kept, 1000);
  // 历史夹具只验证原生用量投影，不作为模型执行成功的证据。
  manager.appendMessage({
    role: 'assistant',
    content: [{ type: 'text', text: '历史回复' }],
    api: 'openai-completions',
    provider: model.provider,
    model: model.id,
    usage: { ...zeroUsage, input: 90, output: 10, cacheRead: 5, totalTokens: 105 },
    stopReason: 'stop',
    timestamp: Date.now()
  });
  const id = await open({ file: manager.getSessionFile()! });
  expect(view(id).usage).toMatchObject({
    input: 90,
    output: 10,
    cacheRead: 5,
    context: { tokens: 105, contextWindow: 8192, percent: (105 / 8192) * 100 }
  });
  options.modelRuntime.registerProvider('larger-window', {
    baseUrl: 'http://127.0.0.1:9',
    api: 'openai-completions',
    apiKey: 'offline-window',
    models: [{ id: 'larger', ...offlineModel, contextWindow: 16384 }]
  });
  await app.execute({ method: 'model', input: { id, model: { provider: 'larger-window', id: 'larger' } } });
  expect(view(id).usage?.context).toEqual({ tokens: 105, contextWindow: 16384, percent: (105 / 16384) * 100 });
});

it('压缩过的历史重开时保留压缩前的对话并标记，总结按记录位置显示', async () => {
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, 'unassigned'));
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  manager.appendMessage({ role: 'user', content: '早先的讨论', timestamp: Date.now() });
  const kept = manager.appendMessage({ role: 'user', content: '最近的要求', timestamp: Date.now() });
  manager.appendCompaction('## 进度：写完第三章', kept, 1200);
  manager.appendMessage({ role: 'user', content: '压缩后的新消息', timestamp: Date.now() });
  const id = await open({ file: manager.getSessionFile()! });

  expect(view(id).readonly).toBeUndefined();
  expect(view(id).messages).toEqual([
    expect.objectContaining({ role: 'user', text: '早先的讨论', compacted: true }),
    expect.not.objectContaining({ compacted: true }),
    expect.objectContaining({ role: 'compactionSummary', text: '## 进度：写完第三章' }),
    expect.objectContaining({ role: 'user', text: '压缩后的新消息' })
  ]);
  expect(view(id).messages[1]).toMatchObject({ role: 'user', text: '最近的要求' });
  expect(
    view(id)
      .messages.slice(2)
      .some(message => message.compacted)
  ).toBe(false);
});

it('空会话的手动压缩给出原因，结束后仍能发送消息', async () => {
  const id = await create(undefined, capture);
  const done = settled();
  await app.execute({ method: 'compact', input: { id } });
  await done;
  expect(view(id)).toMatchObject({ running: false, compacting: false, error: '对话内容较少，暂时无需压缩' });
  const next = settled();
  await app.execute({ method: 'prompt', input: { id, text: '继续讨论' } });
  await next;
  expect(view(id).messages.some(message => message.text === '继续讨论')).toBe(true);
});

it('生成请求在重载阶段已占用会话，手动压缩不能中止它', async () => {
  const id = await create(undefined, capture);
  const session = app.liveSession(id)!;
  const reload = session.reload.bind(session);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  session.reload = async () => {
    await gate;
    await reload();
  };
  await app.execute({ method: 'instructions', input: { id, entries: [entry('更新', 'system', '新指令')] } });
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '继续写作' } });
  try {
    await expect(app.execute({ method: 'compact', input: { id } })).rejects.toThrow('该会话正在运行');
    expect(view(id)).toMatchObject({ running: true, compacting: false });
  } finally {
    release();
    await done;
  }
  expect(view(id).messages.some(message => message.text === '继续写作')).toBe(true);
});

it('手动压缩进入原生入口的等待期间取消，后续不会发出总结请求', async () => {
  const input = history(Array.from({ length: 10 }, (_, i) => `章节${i}：${'雾'.repeat(4000)}`));
  const id = await open(input);
  await app.execute({ method: 'model', input: { id, model: capture } });
  const session = app.liveSession(id)!;
  const abort = session.abort.bind(session);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  // 暂停 compact() 在创建取消控制器前的首次 await，保留真正的 SDK 调用。
  session.abort = async () => {
    session.abort = abort;
    await gate;
    await abort();
  };
  const done = settled();
  await app.execute({ method: 'compact', input: { id } });
  const cancelled = app.execute({ method: 'cancel', input: { id } });
  release();
  await cancelled;
  await done;
  expect(captured).toEqual([]);
  expect(view(id)).toMatchObject({ running: false, compacting: false, messages: expect.any(Array) });
  expect(view(id).error).toBeUndefined();
});

it.each(['取消', '失败'] as const)('手动压缩%s后恢复空闲，压缩中拒绝并发请求且不影响其他会话', async result => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  const failures: (() => void)[] = [];
  let failing = false;
  options.modelRuntime.registerProvider(capture.provider, {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-capture',
    api: 'application-capture',
    models: [{ id: capture.id, ...offlineModel }],
    streamSimple: (target, context, streamOptions) => {
      captured.push(structuredClone(context.messages));
      const stream = createAssistantMessageEventStream();
      // 在供应商边界暂停请求，只返回错误或取消，不生成模型回复。
      const finish = (aborted: boolean) =>
        stream.push({
          type: 'error',
          reason: aborted ? 'aborted' : 'error',
          error: {
            role: 'assistant',
            content: [],
            api: target.api,
            provider: target.provider,
            model: target.id,
            usage: zeroUsage,
            stopReason: aborted ? 'aborted' : 'error',
            errorMessage: '离线压缩故障',
            timestamp: Date.now()
          }
        });
      failures.push(() => finish(false));
      if (failing) queueMicrotask(() => finish(false));
      streamOptions?.signal?.addEventListener('abort', () => finish(true), { once: true });
      markStarted();
      return stream;
    }
  });
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, 'unassigned'));
  manager.appendModelChange(capture.provider, capture.id);
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  for (let i = 0; i < 10; i++)
    manager.appendMessage({ role: 'user', content: `章节${i}：${'雾'.repeat(4000)}`, timestamp: Date.now() });
  const id = await open({ file: manager.getSessionFile()! });
  const other = await create();
  app.liveSession(id)!.settingsManager.setRetryEnabled(false);
  const original = view(id).messages;
  const done = settled();
  const accepted = app.execute({ method: 'compact', input: { id } });
  // 原生 compact() 的首个 await 之前，应用就须占用会话。
  const duplicate = app.execute({ method: 'compact', input: { id } });
  await expect(duplicate).rejects.toThrow('该会话正在运行');
  await accepted;
  await started;
  try {
    expect(view(id)).toMatchObject({ running: true, compacting: true });
    await expect(app.execute({ method: 'prompt', input: { id, text: '并发发送' } })).rejects.toThrow('该会话正在运行');
    await expect(app.execute({ method: 'model', input: { id, model } })).rejects.toThrow('当前请求结束');
    await expect(app.execute({ method: 'deleteProvider', input: { id: capture.provider } })).rejects.toThrow(
      '结束后再删除'
    );
    expect(app.snapshot().sessions.find(session => session.id === id)?.compacting).toBe(true);
    expect(view(other)).toMatchObject({ running: false, compacting: false });
    expect(JSON.stringify(captured)).toContain('剧情进度');
  } finally {
    if (result === '取消') await app.execute({ method: 'cancel', input: { id } });
    else {
      failing = true;
      for (const fail of failures) fail();
    }
    await done;
  }
  expect(view(id)).toMatchObject({ running: false, compacting: false, messages: original });
  if (result === '取消') expect(view(id).error).toBeUndefined();
  else expect(view(id).error).toContain('离线压缩故障');
});
