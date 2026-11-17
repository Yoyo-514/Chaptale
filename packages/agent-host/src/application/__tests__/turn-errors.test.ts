import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { expect, it } from 'vitest';

import { type HostEvent } from '../../protocol/index.ts';
import {
  setupHost,
  app,
  options,
  zeroUsage,
  offlineModel,
  create,
  open,
  view,
  settled,
  restart
} from './host-fixture.ts';

setupHost();

it('流式生成中途失败保留已输出文字并投影真实 errorMessage，重开后保持且不附加会话级冗余错误', async () => {
  options.modelRuntime.registerProvider('mid-error', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-error',
    api: 'application-mid-error',
    models: [{ id: 'offline', ...offlineModel }],
    streamSimple: target => {
      const stream = createAssistantMessageEventStream();
      const partial = {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: '黛玉正欲开口，忽闻窗外风竹作响。' }],
        api: target.api,
        provider: target.provider,
        model: target.id,
        usage: zeroUsage,
        stopReason: 'error' as const,
        errorMessage: '401 {"error":{"message":"Invalid API key"}}',
        timestamp: Date.now()
      };
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: { ...partial, content: [] } });
        stream.push({
          type: 'text_delta',
          contentIndex: 0,
          delta: '黛玉正欲开口，忽闻窗外风竹作响。',
          partial
        });
        stream.push({ type: 'error', reason: 'error', error: partial });
      });
      return stream;
    }
  });
  await restart();
  const id = await create(undefined, { provider: 'mid-error', id: 'offline' });
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '续写潇湘馆夜谈' } });
  await done;

  const session = view(id);
  expect(session.error).toBeUndefined();
  expect(session.messages).toMatchObject([
    { role: 'user', text: '续写潇湘馆夜谈' },
    {
      role: 'assistant',
      text: '黛玉正欲开口，忽闻窗外风竹作响。',
      error: true,
      errorMessage: '401 {"error":{"message":"Invalid API key"}}'
    }
  ]);

  const file = session.file;
  await app.execute({ method: 'close', input: { id } });
  const reopened = await open({ file });
  expect(view(reopened).messages[1]).toMatchObject({
    role: 'assistant',
    text: '黛玉正欲开口，忽闻窗外风竹作响。',
    error: true,
    errorMessage: '401 {"error":{"message":"Invalid API key"}}'
  });
});

it('自动退避重试暴露原因与进度、隐藏已恢复的中间失败，耗尽或中途取消按最终状态投影', async () => {
  let calls = 0;
  let mode: 'recover' | 'exhaust' | 'cancel-sleep' = 'recover';
  options.modelRuntime.registerProvider('retry-provider', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-retry',
    api: 'application-retry',
    models: [{ id: 'offline', ...offlineModel }],
    streamSimple: target => {
      calls++;
      const stream = createAssistantMessageEventStream();
      if (mode === 'recover' && calls === 2) {
        const ok = {
          role: 'assistant' as const,
          content: [{ type: 'text' as const, text: '重试恢复后的正式正文。' }],
          api: target.api,
          provider: target.provider,
          model: target.id,
          usage: zeroUsage,
          stopReason: 'stop' as const,
          timestamp: Date.now()
        };
        queueMicrotask(() => {
          stream.push({ type: 'start', partial: { ...ok, content: [] } });
          stream.push({ type: 'text_delta', contentIndex: 0, delta: '重试恢复后的正式正文。', partial: ok });
          stream.push({ type: 'done', reason: 'stop', message: ok });
        });
        return stream;
      }
      const failed = {
        role: 'assistant' as const,
        content: [],
        api: target.api,
        provider: target.provider,
        model: target.id,
        usage: zeroUsage,
        stopReason: 'error' as const,
        errorMessage: `429 rate limit exceeded (attempt ${calls})`,
        timestamp: Date.now()
      };
      queueMicrotask(() => stream.push({ type: 'error', reason: 'error', error: failed }));
      return stream;
    }
  });
  await restart();
  const retryModel = { provider: 'retry-provider', id: 'offline' };

  // 1. 首次 429 触发退避重试：等待期间暴露 retrying 原因并隐藏中间空错消息，恢复成功后只留正式回复。
  const first = await create(undefined, retryModel);
  app.liveSession(first)!.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 2, baseDelayMs: 80 } });
  const retryEvents: HostEvent[] = [];
  const off = app.subscribe(event => {
    if (event.kind === 'running' && event.id === first && event.retrying) retryEvents.push(event);
  });
  const firstDone = settled();
  await app.execute({ method: 'prompt', input: { id: first, text: '写第一场' } });
  await expect.poll(() => view(first).retrying?.attempt).toBe(1);
  expect(view(first).retrying).toMatchObject({
    attempt: 1,
    maxAttempts: 2,
    errorMessage: '429 rate limit exceeded (attempt 1)'
  });
  expect(view(first).messages.map(m => m.role)).toEqual(['user']);
  await firstDone;
  off();
  expect(retryEvents.length).toBeGreaterThan(0);
  expect(view(first).retrying).toBeUndefined();
  expect(view(first).messages).toMatchObject([
    { role: 'user', text: '写第一场' },
    { role: 'assistant', text: '重试恢复后的正式正文。' }
  ]);
  expect(view(first).messages[1]!.error).toBeUndefined();

  // 重开后中间被 SDK 忽略的失败尝试仍不展示。
  const firstFile = view(first).file;
  await app.execute({ method: 'close', input: { id: first } });
  const firstReopened = await open({ file: firstFile });
  expect(view(firstReopened).messages).toMatchObject([
    { role: 'user', text: '写第一场' },
    { role: 'assistant', text: '重试恢复后的正式正文。' }
  ]);

  // 2. 重试等待期间主动取消：按已停止生成收尾，不标为 error 也不误标为 compacted。
  calls = 0;
  mode = 'cancel-sleep';
  const second = await create(undefined, retryModel);
  app.liveSession(second)!.settingsManager.applyOverrides({
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 120 }
  });
  const secondDone = settled();
  await app.execute({ method: 'prompt', input: { id: second, text: '写第二场' } });
  await expect.poll(() => view(second).retrying?.attempt).toBe(1);
  await app.execute({ method: 'cancel', input: { id: second } });
  await secondDone;
  expect(view(second).retrying).toBeUndefined();
  expect(view(second).messages).toMatchObject([
    { role: 'user', text: '写第二场' },
    { role: 'assistant', aborted: true }
  ]);
  expect(view(second).messages[1]!.error).toBeUndefined();
  expect(view(second).messages[1]!.compacted).toBeUndefined();

  // 3. 全部重试耗尽仍失败：只展示最后一次失败，携带 error 与真实 errorMessage。
  calls = 0;
  mode = 'exhaust';
  const third = await create(undefined, retryModel);
  app.liveSession(third)!.settingsManager.applyOverrides({ retry: { enabled: true, maxRetries: 1, baseDelayMs: 20 } });
  const thirdDone = settled();
  await app.execute({ method: 'prompt', input: { id: third, text: '写第三场' } });
  await thirdDone;
  expect(view(third).messages).toMatchObject([
    { role: 'user', text: '写第三场' },
    { role: 'assistant', error: true, errorMessage: '429 rate limit exceeded (attempt 2)' }
  ]);
});

it('流式生成期间主动停止投影 aborted 且不标 error；手动压缩提示分级并支持 dismissError 关闭', async () => {
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  options.modelRuntime.registerProvider('abort-mid', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-abort',
    api: 'application-abort-mid',
    models: [{ id: 'offline', ...offlineModel }],
    streamSimple: (target, _ctx, req) => {
      const stream = createAssistantMessageEventStream();
      const partial = {
        role: 'assistant' as const,
        content: [{ type: 'text' as const, text: '刚写了两句' }],
        api: target.api,
        provider: target.provider,
        model: target.id,
        usage: zeroUsage,
        stopReason: 'aborted' as const,
        timestamp: Date.now()
      };
      queueMicrotask(() => {
        stream.push({ type: 'start', partial: { ...partial, content: [] } });
        stream.push({ type: 'text_delta', contentIndex: 0, delta: '刚写了两句', partial });
        markStarted();
      });
      req?.signal?.addEventListener('abort', () => stream.push({ type: 'error', reason: 'aborted', error: partial }), {
        once: true
      });
      return stream;
    }
  });
  await restart();
  const id = await create(undefined, { provider: 'abort-mid', id: 'offline' });
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '写一段' } });
  await started;
  await app.execute({ method: 'cancel', input: { id } });
  await done;
  expect(view(id).messages[1]).toMatchObject({ role: 'assistant', text: '刚写了两句', aborted: true });
  expect(view(id).messages[1]!.error).toBeUndefined();

  // 内容较少无需压缩时标记 noticeLevel: 'info'，并可通过 dismissError 清除。
  const compactDone = settled();
  await app.execute({ method: 'compact', input: { id } });
  await compactDone;
  expect(view(id)).toMatchObject({ error: '对话内容较少，暂时无需压缩', noticeLevel: 'info' });
  await app.execute({ method: 'dismissError', input: { id } });
  expect(view(id).error).toBeUndefined();
  expect(view(id).noticeLevel).toBeUndefined();
});
