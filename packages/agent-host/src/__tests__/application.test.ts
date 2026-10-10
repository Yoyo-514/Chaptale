import { InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { HostApplication, type HostApplicationOptions } from '../application.ts';
import type { HostEvent } from '../protocol.ts';

let root: string;
let app: HostApplication;
let options: HostApplicationOptions;
let savedPrompt: string;
const model = { provider: 'application-test', id: 'offline-model' };

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-application-'));
  for (const part of ['agent', 'sessions', 'work']) await mkdir(join(root, part));
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false
  });
  runtime.registerProvider(model.provider, {
    baseUrl: 'http://127.0.0.1:9',
    api: 'openai-completions',
    models: [
      {
        id: model.id,
        name: '离线模型',
        reasoning: false,
        input: ['text'],
        contextWindow: 8192,
        maxTokens: 512,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ]
  });
  savedPrompt = '';
  options = {
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    modelRuntime: runtime,
    defaultSystemPrompt: '应用默认提示词',
    saveDefaultSystemPrompt: async text => {
      savedPrompt = text;
    },
    configureModel: async () => {
      throw new Error('本测试不配置模型');
    },
    tools: () => []
  };
  app = await HostApplication.create(options);
});

afterEach(async () => {
  await app.dispose();
  await rm(root, { recursive: true, force: true });
});

async function create() {
  return (await app.execute({ method: 'create', input: { model } })) as string;
}

function history(text = '历史输入', prompt = '会话自己的提示词') {
  const manager = SessionManager.create(options.cwd, options.sessionDir);
  manager.appendCustomEntry('chaptale-system-prompt', { text: prompt });
  manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  return { file: manager.getSessionFile()!, cwd: options.cwd };
}

it('重连读取快照不会创建新执行者，返回值不能修改宿主状态', async () => {
  const first = await create();
  const second = await create();
  const snapshot = app.snapshot();
  snapshot.sessions[0].systemPrompt = '修改界面副本';
  expect(app.snapshot().sessions.map(value => value.id)).toEqual([first, second]);
  expect(app.snapshot().sessions[0].systemPrompt).toBe('应用默认提示词');
  expect(await readdir(options.sessionDir)).toEqual([]);
});

it('应用默认值仅影响之后创建的会话，独立提示词不串用', async () => {
  const first = await create();
  await app.execute({ method: 'defaultSystemPrompt', input: { text: '新的默认值' } });
  const second = await create();
  await app.execute({ method: 'systemPrompt', input: { id: first, text: '第一位独立配置' } });
  expect(savedPrompt).toBe('新的默认值');
  expect(app.snapshot().sessions).toMatchObject([
    { id: first, systemPrompt: '第一位独立配置' },
    { id: second, systemPrompt: '新的默认值' }
  ]);
});

it('默认设置保存失败不更新内存或已有会话', async () => {
  await app.dispose();
  app = await HostApplication.create({
    ...options,
    saveDefaultSystemPrompt: async () => {
      throw new Error('存储不可写');
    }
  });
  const id = await create();
  await expect(app.execute({ method: 'defaultSystemPrompt', input: { text: '不能保存的内容' } })).rejects.toThrow(
    '存储不可写'
  );
  expect(app.snapshot().defaultSystemPrompt).toBe('应用默认提示词');
  expect(app.snapshot().sessions).toMatchObject([{ id, systemPrompt: '应用默认提示词' }]);
});

it('严格重开保留原消息与会话提示词，并发打开不重复占用', async () => {
  const input = history();
  const original = await readFile(input.file, 'utf8');
  const ids = await Promise.all([app.execute({ method: 'open', input }), app.execute({ method: 'open', input })]);
  expect(ids[0]).toBe(ids[1]);
  expect(app.snapshot().sessions).toMatchObject([
    {
      systemPrompt: '会话自己的提示词',
      messages: [{ role: 'user', text: '历史输入' }]
    }
  ]);
  // 允许原生 SDK 追加运行设置；原有历史字节必须完整保留。
  expect((await readFile(input.file, 'utf8')).startsWith(original)).toBe(true);
});

it('修改后的会话提示词随原生历史重开，不跟随应用默认值', async () => {
  const input = history();
  const id = (await app.execute({ method: 'open', input })) as string;
  await app.execute({ method: 'systemPrompt', input: { id, text: '更新后的会话提示词' } });
  await app.execute({ method: 'close', input: { id } });
  await app.dispose();
  app = await HostApplication.create({ ...options, defaultSystemPrompt: '另一份默认值' });
  await app.execute({ method: 'open', input });
  expect(app.snapshot().sessions[0].systemPrompt).toBe('更新后的会话提示词');
  expect(app.snapshot().sessions[0].messages[0].text).toBe('历史输入');
});

it('历史列表可打开真实 JSONL，关闭一个会话不关闭其他会话或删除文件', async () => {
  const input = history('查找这段历史');
  const first = (await app.execute({ method: 'open', input })) as string;
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
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: 'session', cursor: state.cursor, session: { id } });
  unsubscribe();
  await app.execute({ method: 'systemPrompt', input: { id, text: '继续使用' } });
  expect(events).toHaveLength(1);
  expect(app.snapshot().sessions[0].systemPrompt).toBe('继续使用');
});

it('凭据缺失通过真实 SDK 失败，结束运行且不影响另一个会话', async () => {
  const first = await create();
  const second = await create();
  const settled = new Promise<void>(resolve => {
    app.subscribe(event => {
      if (event.kind === 'running' && !event.running) resolve();
    });
  });
  await app.execute({ method: 'prompt', input: { id: first, text: '没有凭据不得请求模型' } });
  await settled;
  expect(app.snapshot().sessions).toMatchObject([
    { id: first, running: false, error: expect.any(String) },
    { id: second, running: false, messages: [] }
  ]);
});

it('没有保存提示词的历史不隐式套用当前默认值，原件保持不变', async () => {
  const manager = SessionManager.create(options.cwd, options.sessionDir);
  manager.appendMessage({ role: 'user', content: '未记录提示词的原生历史', timestamp: Date.now() });
  const file = manager.getSessionFile()!;
  const original = await readFile(file, 'utf8');
  await expect(app.execute({ method: 'open', input: { file, cwd: options.cwd } })).rejects.toThrow(
    '历史未保存应用系统提示词'
  );
  expect(await readFile(file, 'utf8')).toBe(original);
  expect(app.snapshot().sessions).toEqual([]);
});

it('重载期间再次修改提示词，在下一次发送生效而不是被丢弃', async () => {
  const id = await create();
  const session = app.liveSession(id)!;
  const reload = session.reload.bind(session);
  let release!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  session.reload = async () => {
    session.reload = reload;
    await gate;
    return reload();
  };
  const settled = () =>
    new Promise<void>(resolve => {
      const off = app.subscribe(event => {
        if (event.kind === 'running' && !event.running) {
          off();
          resolve();
        }
      });
    });

  await app.execute({ method: 'systemPrompt', input: { id, text: '第一次修改' } });
  const first = settled();
  await app.execute({ method: 'prompt', input: { id, text: '第一次发送' } });
  await app.execute({ method: 'systemPrompt', input: { id, text: '重载期间再次修改' } });
  release();
  await first;
  expect(session.systemPrompt).toContain('第一次修改');

  const second = settled();
  await app.execute({ method: 'prompt', input: { id, text: '第二次发送' } });
  await second;
  expect(session.systemPrompt).toContain('重载期间再次修改');
});

it('已经结束的授权请求不能被批准', async () => {
  await expect(app.execute({ method: 'approve', input: { id: 'finished', allow: true } })).rejects.toThrow(
    '授权请求已结束'
  );
});
