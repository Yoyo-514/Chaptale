import { createAssistantMessageEventStream } from '@earendil-works/pi-ai';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { type HostEvent, instructionsEntryType, modeEntryType } from '../../protocol/index.ts';
import {
  setupHost,
  root,
  app,
  options,
  captured,
  model,
  capture,
  entry,
  builtin,
  zeroUsage,
  offlineModel,
  makeEditorContext,
  create,
  open,
  view,
  settled,
  history
} from './host-fixture.ts';

setupHost();

it('重连读取快照不会创建新执行者，返回值不能修改宿主状态', async () => {
  const first = await create();
  const second = await create();
  const snapshot = app.snapshot();
  snapshot.sessions[0].instructions[0].text = '修改界面副本';
  expect(app.snapshot().sessions.map(value => value.id)).toEqual([first, second]);
  expect(view(first).instructions).toEqual(builtin);
  expect(await readdir(join(options.sessionDir, 'unassigned'))).toEqual([]);
});

it('未归属作品的会话共用宿主的空工作目录，各自保留原生执行者', async () => {
  const first = await create();
  const executor = app.liveSession(first);
  const second = await create();
  for (const id of [first, second]) expect(app.liveSession(id)!.sessionManager.getCwd()).toBe(options.cwd);
  expect(app.liveSession(first)).toBe(executor);
  expect(app.snapshot().sessions.map(session => session.id)).toEqual([first, second]);
});

it('枚举宿主管理目录中的历史，打开时按所在目录的归属确定工作目录', async () => {
  const work = join(root, 'first-work');
  await mkdir(work);
  const own = history(['独立会话历史']);
  const manager = SessionManager.create(work, join(options.sessionDir, 'unassigned'));
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  manager.appendMessage({ role: 'user', content: '作品会话历史', timestamp: Date.now() });
  const items = await app.execute({ method: 'history', input: undefined });
  expect(items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ id: manager.getSessionId(), file: manager.getSessionFile(), title: '作品会话历史' }),
      expect.objectContaining({ file: own.file, title: '独立会话历史' })
    ])
  );
  expect(items).toHaveLength(2);
  const opened = await open({ file: manager.getSessionFile()! });
  expect(view(opened).sessionId).toBe(manager.getSessionId());
  expect(app.liveSession(opened)!.sessionManager.getCwd()).toBe(options.cwd);
});

it('重命名写入原生记录，历史与重开均使用新名称，只读历史不能重命名', async () => {
  const id = await create();
  await expect(app.execute({ method: 'rename', input: { id, name: '  ' } })).rejects.toThrow('不能为空');
  await app.execute({ method: 'rename', input: { id, name: ' 第三卷大纲 ' } });
  expect(view(id).name).toBe('第三卷大纲');
  const item = history(['历史输入']);
  const opened = await open(item);
  await app.execute({ method: 'rename', input: { id: opened, name: '人物小传' } });
  await app.execute({ method: 'close', input: { id: opened } });
  const items = (await app.execute({ method: 'history', input: undefined })) as { file: string; title: string }[];
  expect(items.find(candidate => candidate.file === item.file)?.title).toBe('人物小传');
  expect(view(await open(item)).name).toBe('人物小传');
  const readonly = await open(history(['旧历史'], {}));
  await expect(app.execute({ method: 'rename', input: { id: readonly, name: '新名' } })).rejects.toThrow('只读');
});

it('严格重开保留原消息与会话指令，并发打开不重复占用', async () => {
  const input = history();
  const original = await readFile(input.file, 'utf8');
  const ids = await Promise.all([open(input), open(input)]);
  expect(ids[0]).toBe(ids[1]);
  expect(app.snapshot().sessions).toMatchObject([
    {
      instructions: [{ text: '会话自己的指令' }],
      mode: 'review',
      messages: [{ role: 'user', text: '历史输入' }]
    }
  ]);
  expect(view(ids[0]).readonly).toBeUndefined();
  // 允许原生 SDK 追加运行设置；原有历史字节必须完整保留。
  expect((await readFile(input.file, 'utf8')).startsWith(original)).toBe(true);
});

it('历史列表可打开真实 JSONL，关闭一个会话不关闭其他会话或删除文件', async () => {
  const input = history(['查找这段历史']);
  const first = await open(input);
  const second = await create();
  await app.execute({ method: 'close', input: { id: first } });
  expect(app.snapshot().sessions.map(value => value.id)).toEqual([second]);
  expect(await app.execute({ method: 'history', input: undefined })).toMatchObject([
    { file: input.file, title: '查找这段历史' }
  ]);
  expect(await readFile(input.file, 'utf8')).toContain('查找这段历史');
});

it('订阅游标与快照对应，取消订阅不取消会话', async () => {
  const events: HostEvent[] = [];
  const unsubscribe = app.subscribe(event => events.push(event));
  const id = await create();
  const state = app.snapshot();
  expect(events).toMatchObject([
    { kind: 'settings', settings: { lastModel: model } },
    { kind: 'session', cursor: state.cursor, session: { id } }
  ]);
  unsubscribe();
  const next = [entry('继续', 'system', '继续使用')];
  await app.execute({ method: 'instructions', input: { id, entries: next } });
  expect(events).toHaveLength(2);
  expect(view(id).instructions).toEqual(next);
});

it('凭据缺失在写入会话历史前直接拒绝，不产生空白助手消息且不影响其他会话', async () => {
  const first = await create();
  const second = await create();
  await expect(app.execute({ method: 'prompt', input: { id: first, text: '没有凭据不得请求模型' } })).rejects.toThrow(
    'API 密钥'
  );
  expect(app.snapshot().sessions).toMatchObject([
    { id: first, running: false, messages: [] },
    { id: second, running: false, messages: [] }
  ]);
});

it('正在生成内容的模型及其供应商不能删除，结束后可以删除', async () => {
  let release!: () => void;
  const busy = { provider: 'application-busy', id: 'busy-model' };
  options.modelRuntime.registerProvider(busy.provider, {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-busy',
    api: 'application-busy',
    models: [{ id: busy.id, ...offlineModel }],
    streamSimple: target => {
      const stream = createAssistantMessageEventStream();
      release = () =>
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
            errorMessage: '离线测试不请求模型',
            timestamp: Date.now()
          }
        });
      return stream;
    }
  });
  await mkdir(join(root, 'config'));
  const id = await create(undefined, busy);
  const running = new Promise<void>(resolve => {
    const off = app.subscribe(event => {
      if (event.kind === 'running' && event.running) {
        off();
        resolve();
      }
    });
  });
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '保持运行' } });
  await running;

  const rejected = '正在生成内容';
  await expect(app.execute({ method: 'deleteProvider', input: { id: busy.provider } })).rejects.toThrow(rejected);
  await expect(
    app.execute({ method: 'saveProvider', input: { id: busy.provider, config: { models: [{ id: 'other' }] } } })
  ).rejects.toThrow(rejected);
  await app.execute({ method: 'deleteProvider', input: { id: model.provider } });

  release();
  await done;
  await app.execute({ method: 'deleteProvider', input: { id: busy.provider } });
  expect(view(id).running).toBe(false);
});

it('编辑历史作者消息基于原生会话树原地分叉，切换分支在重开历史后仍保留', async () => {
  const id = await create(undefined, capture);
  const context = makeEditorContext('第一回');

  let done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '旧构思', editorContext: context } });
  await done;
  const firstEntryId = view(id).messages.find(message => message.role === 'user')!.entryId!;
  expect(firstEntryId).toBeTruthy();

  done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '继续推演' } });
  await done;
  expect(
    view(id)
      .messages.filter(message => message.role === 'user')
      .map(message => message.text)
  ).toEqual(['旧构思', '继续推演']);

  captured.length = 0;
  done = settled();
  await app.execute({
    method: 'editMessage',
    input: { id, entryId: firstEntryId, text: '新构思', editorContext: context }
  });
  await done;

  const sentTexts = JSON.stringify(captured[0]);
  expect(sentTexts).toContain('新构思');
  expect(sentTexts).not.toContain('旧构思');
  expect(sentTexts).not.toContain('继续推演');

  const forkedUser = view(id).messages.find(message => message.role === 'user')!;
  expect(forkedUser).toMatchObject({
    text: '新构思',
    editorContext: context,
    branch: { index: 2, total: 2, prevLeafId: expect.any(String) }
  });

  await app.execute({ method: 'switchBranch', input: { id, leafId: forkedUser.branch!.prevLeafId! } });
  const branchOneUsers = view(id).messages.filter(message => message.role === 'user');
  expect(branchOneUsers.map(message => message.text)).toEqual(['旧构思', '继续推演']);
  expect(branchOneUsers[0]?.branch).toMatchObject({ index: 1, total: 2, nextLeafId: expect.any(String) });

  const file = view(id).file;
  await app.execute({ method: 'close', input: { id } });
  const reopened = await open({ file });
  const reopenedUsers = view(reopened).messages.filter(message => message.role === 'user');
  expect(reopenedUsers.map(message => message.text)).toEqual(['旧构思', '继续推演']);
  expect(reopenedUsers[0]?.branch).toMatchObject({ index: 1, total: 2, nextLeafId: expect.any(String) });
});
