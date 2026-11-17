import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';

import { type EditorContext } from '../../protocol/index.ts';
import {
  setupHost,
  app,
  options,
  captured,
  capture,
  zeroUsage,
  offlineModel,
  makeEditorContext,
  create,
  open,
  view,
  settled
} from './host-fixture.ts';

setupHost();

it('每条作者消息附带当前打开标签定位与选区原文，重开后保持关联', async () => {
  const id = await create(undefined, capture);
  const editorContext: EditorContext = {
    workId: 'work',
    entryId: 'chapter',
    title: '第三回',
    section: 'manuscript',
    selection: '选中的原句'
  };
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '润色这里', editorContext } });
  editorContext.title = '发送后切到另一章';
  await done;
  const sent = view(id).messages.find(message => message.role === 'user')!;
  expect(sent.text).toBe('润色这里');
  expect(sent.editorContext).toEqual({
    workId: 'work',
    entryId: 'chapter',
    title: '第三回',
    section: 'manuscript',
    selection: '选中的原句'
  });
  expect(JSON.stringify(captured)).toContain('当前打开：文稿《第三回》（entryId: chapter，workId: work）');
  expect(JSON.stringify(captured)).toContain('选中的原句');
  expect(JSON.stringify(captured)).not.toContain('发送后切到另一章');
  const file = view(id).file;
  await app.execute({ method: 'close', input: { id } });
  const reopened = await open({ file });
  expect(view(reopened).messages.find(message => message.role === 'user')!.editorContext).toEqual(sent.editorContext);
});

it('连续同文插话与后续起始输入按原生排队顺序保留各自的打开标签与选区', async () => {
  const id = await create(undefined, capture);
  const session = app.liveSession(id)!;
  session.settingsManager.setRetryEnabled(false);
  let entered!: () => void;
  let release!: () => void;
  const starting = new Promise<void>(resolve => {
    entered = resolve;
  });
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const original = session.agent.streamFunction;
  let first = true;
  session.agent.streamFunction = async (...args) => {
    if (first) {
      first = false;
      entered();
      await gate;
    }
    return original(...args);
  };
  const owners = new WeakMap<object, string>();
  let expectedStarting = '甲';
  const observed: string[] = [];
  const off = session.subscribe(event => {
    if (event.type === 'message_start' && event.message.role === 'user')
      observed.push(owners.get(event.message) ?? expectedStarting);
  });
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '改这里', editorContext: makeEditorContext('甲') } });
  try {
    await starting;
    await app.execute({ method: 'prompt', input: { id, text: '改这里', editorContext: makeEditorContext('乙') } });
    await app.execute({ method: 'prompt', input: { id, text: '改这里', editorContext: makeEditorContext('丙') } });
    const mode = session.agent.steeringMode;
    session.agent.steeringMode = 'all';
    const queued = session.agent.peekQueuedMessages().filter(message => message.role === 'user');
    session.agent.steeringMode = mode;
    expect(queued).toHaveLength(2);
    owners.set(queued[0], '乙');
    owners.set(queued[1], '丙');
  } finally {
    release();
    await done;
  }
  for (const title of ['丁', '戊']) {
    expectedStarting = title;
    const finished = settled();
    await app.execute({ method: 'prompt', input: { id, text: '改这里', editorContext: makeEditorContext(title) } });
    await finished;
  }
  off();
  const users = view(id).messages.filter(message => message.role === 'user');
  expect(users.map(message => message.editorContext!.title)).toEqual(observed);
  expect(users.map(message => message.editorContext!.selection)).toEqual(observed.map(title => `选中${title}`));
  expect(users.every(message => message.text === '改这里')).toBe(true);
  expect(captured.length).toBeLessThanOrEqual(users.length);
});

it('取消运行会清空排队中的插话及其快照，下一条新消息不会错绑旧上下文', async () => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  let hangFirst = true;
  options.modelRuntime.registerProvider('abort-capture', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-capture',
    api: 'application-abort-capture',
    models: [{ id: 'offline', ...offlineModel }],
    streamSimple: (target, _context, request) => {
      const stream = createAssistantMessageEventStream();
      if (hangFirst) {
        hangFirst = false;
        request?.signal?.addEventListener(
          'abort',
          () =>
            stream.push({
              type: 'error',
              reason: 'aborted',
              error: {
                role: 'assistant',
                content: [],
                api: target.api,
                provider: target.provider,
                model: target.id,
                usage: zeroUsage,
                stopReason: 'aborted',
                errorMessage: '离线请求已取消',
                timestamp: Date.now()
              }
            }),
          { once: true }
        );
        markStarted();
      } else {
        queueMicrotask(() =>
          stream.push({
            type: 'error',
            reason: 'error',
            error: {
              role: 'assistant',
              content: [],
              api: target.api,
              provider: target.provider,
              model: target.id,
              usage: zeroUsage,
              stopReason: 'error',
              errorMessage: '离线捕获结束',
              timestamp: Date.now()
            }
          })
        );
      }
      return stream;
    }
  });
  const id = await create(undefined, { provider: 'abort-capture', id: 'offline' });
  const session = app.liveSession(id)!;
  session.settingsManager.setRetryEnabled(false);
  await app.execute({ method: 'prompt', input: { id, text: '首轮', editorContext: makeEditorContext('甲') } });
  await started;
  await app.execute({ method: 'prompt', input: { id, text: '插话', editorContext: makeEditorContext('乙') } });
  expect(session.getSteeringMessages()).toHaveLength(1);
  await app.execute({ method: 'cancel', input: { id } });
  expect(session.getSteeringMessages()).toEqual([]);
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '新消息', editorContext: makeEditorContext('丙') } });
  await done;
  const users = view(id).messages.filter(message => message.role === 'user');
  expect(users.map(message => [message.text, message.editorContext?.title])).toEqual([
    ['首轮', '甲'],
    ['新消息', '丙']
  ]);
});

it('生成中发送通过原生插话队列接收，空消息被拒绝且其他会话保持空闲', async () => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  options.modelRuntime.registerProvider(capture.provider, {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-capture',
    api: 'application-capture',
    models: [{ id: capture.id, ...offlineModel }],
    streamSimple: (target, _context, request) => {
      const stream = createAssistantMessageEventStream();
      // 真实 SDK 请求保持未完成，取消时返回错误，不生成模型回复。
      request?.signal?.addEventListener(
        'abort',
        () =>
          stream.push({
            type: 'error',
            reason: 'aborted',
            error: {
              role: 'assistant',
              content: [],
              api: target.api,
              provider: target.provider,
              model: target.id,
              usage: zeroUsage,
              stopReason: 'aborted',
              errorMessage: '离线请求已取消',
              timestamp: Date.now()
            }
          }),
        { once: true }
      );
      markStarted();
      return stream;
    }
  });
  const id = await create(undefined, capture);
  const other = await create();
  await app.execute({ method: 'prompt', input: { id, text: '开始写作' } });
  await started;
  try {
    await app.execute({ method: 'prompt', input: { id, text: '先停在第三章' } });
    await expect(app.execute({ method: 'prompt', input: { id, text: '  ' } })).rejects.toThrow('消息不能为空');
    expect(app.liveSession(id)!.getSteeringMessages()).toEqual(['先停在第三章']);
    expect(view(id).running).toBe(true);
    expect(view(other).running).toBe(false);
  } finally {
    await app.execute({ method: 'cancel', input: { id } });
  }
  expect(view(id).running).toBe(false);
});

it('生成中支持插话与稍后处理排队投影，并可单条撤回保留其余排队消息与选区', async () => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  options.modelRuntime.registerProvider(capture.provider, {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-capture',
    api: 'application-capture',
    models: [{ id: capture.id, ...offlineModel }],
    streamSimple: (target, _context, request) => {
      const stream = createAssistantMessageEventStream();
      request?.signal?.addEventListener(
        'abort',
        () =>
          stream.push({
            type: 'error',
            reason: 'aborted',
            error: {
              role: 'assistant',
              content: [],
              api: target.api,
              provider: target.provider,
              model: target.id,
              usage: zeroUsage,
              stopReason: 'aborted',
              errorMessage: '离线请求已取消',
              timestamp: Date.now()
            }
          }),
        { once: true }
      );
      markStarted();
      return stream;
    }
  });
  const id = (await app.execute({ method: 'create', input: { model: capture, workId: null } })) as string;
  await app.execute({ method: 'prompt', input: { id, text: '先写第一回' } });
  await started;
  const quote = {
    workId: 'work-1',
    entryId: 'doc-1',
    title: '第一回',
    section: 'manuscript' as const,
    selection: '残月如钩'
  };
  try {
    await app.execute({ method: 'prompt', input: { id, text: '这里节奏放慢', delivery: 'steer' } });
    await app.execute({
      method: 'prompt',
      input: { id, text: '写完后补一份人物卡', editorContext: quote, delivery: 'followUp' }
    });
    expect(view(id).queued).toEqual([
      { delivery: 'steer', text: '这里节奏放慢', editorContext: undefined },
      { delivery: 'followUp', text: '写完后补一份人物卡', editorContext: quote }
    ]);

    const removed = await app.execute({ method: 'dequeue', input: { id, delivery: 'followUp', index: 1 } });
    expect(removed).toEqual({
      delivery: 'followUp',
      text: '写完后补一份人物卡',
      editorContext: quote
    });
    expect(view(id).queued).toEqual([{ delivery: 'steer', text: '这里节奏放慢', editorContext: undefined }]);
    expect(app.liveSession(id)!.getFollowUpMessages()).toEqual([]);
    expect(app.liveSession(id)!.getSteeringMessages()).toEqual(['这里节奏放慢']);

    expect(await app.execute({ method: 'dequeue', input: { id, delivery: 'followUp', index: 5 } })).toBeNull();
  } finally {
    await app.execute({ method: 'cancel', input: { id } });
  }
  expect(view(id).queued).toEqual([]);
});
