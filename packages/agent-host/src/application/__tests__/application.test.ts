import { createAssistantMessageEventStream, InMemoryCredentialStore, type Message } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it } from 'vitest';

import {
  type AgentInstructions,
  type EditMode,
  type HostEvent,
  type InstructionEntry,
  instructionsEntryType,
  modeEntryType
} from '../../protocol.ts';
import { HostModelConfiguration } from '../../runtime/model-configuration.ts';
import { HostApplication, type HostApplicationOptions } from '../index.ts';

let root: string;
let app: HostApplication;
let options: HostApplicationOptions;
let captured: Message[][];
const model = { provider: 'application-test', id: 'offline-model' };
const capture = { provider: 'application-capture', id: 'capture-model' };

function entry(name: string, role: InstructionEntry['role'], text: string, enabled = true): InstructionEntry {
  return { name, role, text, enabled };
}
const builtin = [entry('主创', 'system', '应用内置指令')];
const zeroUsage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};
const offlineModel = {
  name: '离线模型',
  reasoning: false,
  input: ['text' as const],
  contextWindow: 8192,
  maxTokens: 512,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
};

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-application-'));
  for (const part of ['agent', 'sessions', 'work', 'data']) await mkdir(join(root, part));
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false
  });
  runtime.registerProvider(model.provider, {
    baseUrl: 'http://127.0.0.1:9',
    api: 'openai-completions',
    models: [{ id: model.id, ...offlineModel }]
  });
  // 只记录 SDK 实际发出的请求并返回错误，不生成模型回复。
  captured = [];
  runtime.registerProvider(capture.provider, {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-capture',
    api: 'application-capture',
    models: [{ id: capture.id, ...offlineModel }],
    streamSimple: (target, context) => {
      captured.push(structuredClone(context.messages));
      const stream = createAssistantMessageEventStream();
      const error = {
        role: 'assistant' as const,
        content: [],
        api: target.api,
        provider: target.provider,
        model: target.id,
        usage: zeroUsage,
        stopReason: 'error' as const,
        errorMessage: '离线测试不请求模型',
        timestamp: Date.now()
      };
      queueMicrotask(() => stream.push({ type: 'error', reason: 'error', error }));
      return stream;
    }
  });
  options = {
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'data', 'settings.json'),
    builtinInstructions: builtin,
    modelRuntime: runtime,
    modelConfiguration: new HostModelConfiguration(join(root, 'config'), runtime),
    tools: () => []
  };
  app = await HostApplication.create(options);
});

afterEach(async () => {
  await app.dispose();
  await rm(root, { recursive: true, force: true });
});

async function create(instructions?: string, target = model) {
  return (await app.execute({ method: 'create', input: { model: target, instructions } })) as string;
}

async function open(input: { file: string; cwd: string }) {
  return (await app.execute({ method: 'open', input })) as string;
}

function view(id: string) {
  return app.snapshot().sessions.find(session => session.id === id)!;
}

function settled() {
  return new Promise<void>(resolve => {
    const off = app.subscribe(event => {
      if (event.kind === 'running' && !event.running) {
        off();
        resolve();
      }
    });
  });
}

function history(
  texts = ['历史输入'],
  records: { entries?: unknown; mode?: EditMode } = {
    entries: [entry('会话', 'system', '会话自己的指令')],
    mode: 'review'
  }
) {
  const manager = SessionManager.create(options.cwd, options.sessionDir);
  if (records.entries) manager.appendCustomEntry(instructionsEntryType, { entries: records.entries });
  if (records.mode) manager.appendCustomEntry(modeEntryType, { mode: records.mode });
  for (const text of texts) manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  return { file: manager.getSessionFile()!, cwd: options.cwd };
}

async function restart(overrides: Partial<HostApplicationOptions> = {}) {
  await app.dispose();
  app = await HostApplication.create({ ...options, ...overrides });
}

it('重连读取快照不会创建新执行者，返回值不能修改宿主状态', async () => {
  const first = await create();
  const second = await create();
  const snapshot = app.snapshot();
  snapshot.sessions[0].instructions[0].text = '修改界面副本';
  expect(app.snapshot().sessions.map(value => value.id)).toEqual([first, second]);
  expect(view(first).instructions).toEqual(builtin);
  expect(await readdir(options.sessionDir)).toEqual([]);
});

it('不同作品与独立会话共用宿主，各自保留创建时的目录和原生执行者', async () => {
  const firstWork = join(root, 'first-work');
  const secondWork = join(root, 'second-work');
  await Promise.all([mkdir(firstWork), mkdir(secondWork)]);
  const first = (await app.execute({ method: 'create', input: { model, cwd: firstWork } })) as string;
  const executor = app.liveSession(first);
  const second = (await app.execute({ method: 'create', input: { model, cwd: secondWork } })) as string;
  const independent = await create();
  expect(view(first).cwd).toBe(firstWork);
  expect(view(second).cwd).toBe(secondWork);
  expect(view(independent).cwd).toBe(options.cwd);
  expect(app.liveSession(first)).toBe(executor);
  expect(app.snapshot().sessions.map(session => session.id)).toEqual([first, second, independent]);
});

it('历史按指定作品目录筛选，独立会话历史使用应用默认目录', async () => {
  const work = join(root, 'first-work');
  await mkdir(work);
  const own = history(['独立会话历史']);
  const manager = SessionManager.create(work, options.sessionDir);
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  manager.appendMessage({ role: 'user', content: '作品会话历史', timestamp: Date.now() });
  const scoped = await app.execute({ method: 'history', input: { cwd: work } });
  expect(scoped).toMatchObject([{ cwd: work, file: manager.getSessionFile(), title: '作品会话历史' }]);
  expect(scoped).toHaveLength(1);
  const independent = await app.execute({ method: 'history', input: undefined });
  expect(independent).toMatchObject([{ cwd: options.cwd, file: own.file, title: '独立会话历史' }]);
  expect(independent).toHaveLength(1);
});

it('不存在的作品目录不能创建会话，既有会话保持可用', async () => {
  const existing = await create();
  const executor = app.liveSession(existing);
  await expect(app.execute({ method: 'create', input: { model, cwd: join(root, 'missing') } })).rejects.toThrow();
  expect(app.snapshot().sessions.map(session => session.id)).toEqual([existing]);
  expect(app.liveSession(existing)).toBe(executor);
});

it('全局默认指令只影响之后创建的会话并写入设置文件，会话指令互不串用', async () => {
  const first = await create();
  const defaults = [entry('新默认', 'system', '新的默认指令')];
  await app.execute({ method: 'defaultInstructions', input: { entries: defaults } });
  const second = await create();
  const own = [entry('独立', 'system', '第一位独立指令')];
  await app.execute({ method: 'instructions', input: { id: first, entries: own } });
  expect(view(first).instructions).toEqual(own);
  expect(view(second).instructions).toEqual(defaults);
  expect(app.snapshot().settings.defaultInstructions).toEqual(defaults);
  expect(JSON.parse(await readFile(options.settingsFile, 'utf8'))).toMatchObject({ defaultInstructions: defaults });
});

it('设置写入失败时不更新内存设置或已有会话', async () => {
  await restart({ settingsFile: join(root, 'missing', 'settings.json') });
  const id = await create();
  await expect(
    app.execute({ method: 'defaultInstructions', input: { entries: [entry('不能保存', 'system', '内容')] } })
  ).rejects.toThrow();
  expect(app.snapshot().settings.defaultInstructions).toEqual(builtin);
  expect(view(id).instructions).toEqual(builtin);
});

it('设置文件损坏时拒绝装配且不改写原文件', async () => {
  await writeFile(options.settingsFile, '{坏的设置', 'utf8');
  await expect(HostApplication.create(options)).rejects.toThrow('应用设置文件损坏');
  expect(await readFile(options.settingsFile, 'utf8')).toBe('{坏的设置');
});

it('指令至少需要一个启用的 system 条目', async () => {
  const id = await create();
  await expect(
    app.execute({
      method: 'instructions',
      input: { id, entries: [entry('关闭', 'system', '停用', false), entry('开场', 'user', '你好')] }
    })
  ).rejects.toThrow('至少需要一个启用的 system 条目');
  expect(view(id).instructions).toEqual(builtin);
});

it('命名指令可保存、选用和删除，修改命名指令不影响已有会话', async () => {
  const named = [entry('悬疑', 'system', '悬疑写作指令'), entry('开场', 'user', '先读大纲')];
  await app.execute({ method: 'namedInstructions', input: { name: '悬疑', entries: named } });
  const id = await create('悬疑');
  expect(view(id).instructions).toEqual(named);

  await app.execute({ method: 'namedInstructions', input: { name: '悬疑', entries: builtin } });
  expect(app.snapshot().settings.namedInstructions).toEqual([{ name: '悬疑', entries: builtin }]);
  expect(view(id).instructions).toEqual(named);

  await app.execute({ method: 'deleteNamedInstructions', input: { name: '悬疑' } });
  expect(app.snapshot().settings.namedInstructions).toEqual([]);
  await expect(create('悬疑')).rejects.toThrow('命名指令不存在');
  await expect(app.execute({ method: 'deleteNamedInstructions', input: { name: '悬疑' } })).rejects.toThrow(
    '命名指令不存在'
  );
});

it('新会话使用全局默认模式，会话模式随历史重开且不跟随设置', async () => {
  const first = await create(undefined, capture);
  expect(view(first).mode).toBe('review');
  await app.execute({ method: 'defaultMode', input: { mode: 'direct' } });
  const second = await create();
  expect(view(second).mode).toBe('direct');

  await app.execute({ method: 'mode', input: { id: first, mode: 'discuss' } });
  await app.execute({ method: 'prompt', input: { id: first, text: '写入文件' } });
  await settled();
  const file = view(first).file;
  await restart();
  expect(app.snapshot().settings.defaultMode).toBe('direct');
  const reopened = await open({ file, cwd: options.cwd });
  expect(view(reopened).mode).toBe('discuss');
  await expect(app.execute({ method: 'mode', input: { id: reopened, mode: 'auto' as EditMode } })).rejects.toThrow(
    '修改模式无效'
  );
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

it('会话用量汇总压缩前后的原生记录，重开保持一致且会话之间隔离', async () => {
  const manager = SessionManager.create(options.cwd, options.sessionDir);
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
  const input = { file: manager.getSessionFile()!, cwd: options.cwd };
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
  const manager = SessionManager.create(options.cwd, options.sessionDir);
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
  const id = await open({ file: manager.getSessionFile()!, cwd: options.cwd });
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
  const manager = SessionManager.create(options.cwd, options.sessionDir);
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  manager.appendMessage({ role: 'user', content: '早先的讨论', timestamp: Date.now() });
  const kept = manager.appendMessage({ role: 'user', content: '最近的要求', timestamp: Date.now() });
  manager.appendCompaction('## 进度：写完第三章', kept, 1200);
  manager.appendMessage({ role: 'user', content: '压缩后的新消息', timestamp: Date.now() });
  const id = await open({ file: manager.getSessionFile()!, cwd: options.cwd });

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

it('修改后的会话指令随原生历史重开，不跟随应用默认值', async () => {
  const input = history();
  const id = await open(input);
  const updated = [entry('更新', 'system', '更新后的会话指令')];
  await app.execute({ method: 'instructions', input: { id, entries: updated } });
  await app.execute({ method: 'close', input: { id } });
  await restart({ builtinInstructions: [entry('另一份', 'system', '另一份内置指令')] });
  const reopened = await open(input);
  expect(view(reopened).instructions).toEqual(updated);
  expect(view(reopened).messages[0].text).toBe('历史输入');
});

it('user/assistant 指令按顺序放在请求最前面，只用于请求，不写入会话消息', async () => {
  const entries: AgentInstructions = [
    entry('主创', 'system', '系统指令'),
    entry('开场', 'user', '先读大纲'),
    entry('停用', 'user', '停用的条目', false),
    entry('回应', 'assistant', '好的，已读大纲')
  ];
  await app.execute({ method: 'namedInstructions', input: { name: '前缀', entries } });
  const id = await create('前缀', capture);
  const done = settled();
  await app.execute({ method: 'prompt', input: { id, text: '写第一章' } });
  await done;

  const conversation = captured[0].filter(message => message.role !== 'system');
  expect(captured[0][0]).toMatchObject({ role: 'system' });
  expect(JSON.stringify(captured[0][0])).toContain('系统指令');
  expect(conversation.map(message => [message.role, JSON.stringify(message.content)])).toEqual([
    ['user', JSON.stringify('先读大纲')],
    ['assistant', JSON.stringify([{ type: 'text', text: '好的，已读大纲' }])],
    ['user', JSON.stringify([{ type: 'text', text: '写第一章' }])]
  ]);
  expect(view(id).messages.map(message => message.text)).not.toContain('先读大纲');
  const reopened = SessionManager.open(view(id).file).buildSessionContext().messages;
  // pi 会把系统提示词记入历史；对话前缀不应出现在历史里。
  expect(reopened.filter(message => message.role !== 'system').map(message => message.role)).toEqual([
    'user',
    'assistant'
  ]);
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
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ kind: 'session', cursor: state.cursor, session: { id } });
  unsubscribe();
  const next = [entry('继续', 'system', '继续使用')];
  await app.execute({ method: 'instructions', input: { id, entries: next } });
  expect(events).toHaveLength(1);
  expect(view(id).instructions).toEqual(next);
});

it('凭据缺失通过真实 SDK 失败，结束运行且不影响另一个会话', async () => {
  const first = await create();
  const second = await create();
  const done = settled();
  await app.execute({ method: 'prompt', input: { id: first, text: '没有凭据不得请求模型' } });
  await done;
  expect(app.snapshot().sessions).toMatchObject([
    { id: first, running: false, error: expect.any(String) },
    { id: second, running: false, messages: [] }
  ]);
});

it('缺少指令或模式记录的历史只读打开，不套用当前默认值，原件保持不变', async () => {
  const cases = [
    history(['没有任何记录'], {}),
    history(['只有指令'], { entries: builtin }),
    history(['只有模式'], { mode: 'review' })
  ];
  for (const input of cases) {
    const original = await readFile(input.file, 'utf8');
    const id = await open(input);
    expect(view(id)).toMatchObject({
      file: input.file,
      instructions: [],
      readonly: { reason: 'incomplete', lines: [] },
      messages: [{ role: 'user' }]
    });
    expect(view(id).mode).toBeUndefined();
    expect(await readFile(input.file, 'utf8')).toBe(original);
  }
});

it('旧格式提示词记录不被识别为指令，历史只读打开', async () => {
  const manager = SessionManager.create(options.cwd, options.sessionDir);
  manager.appendCustomEntry('chaptale-system-prompt', { text: '旧提示词' });
  manager.appendMessage({ role: 'user', content: '旧历史', timestamp: Date.now() });
  const id = await open({ file: manager.getSessionFile()!, cwd: options.cwd });
  expect(view(id).readonly?.reason).toBe('incomplete');
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
  const manager = SessionManager.create(options.cwd, options.sessionDir);
  manager.appendModelChange(capture.provider, capture.id);
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  for (let i = 0; i < 10; i++)
    manager.appendMessage({ role: 'user', content: `章节${i}：${'雾'.repeat(4000)}`, timestamp: Date.now() });
  const id = await open({ file: manager.getSessionFile()!, cwd: options.cwd });
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

it('只读历史拒绝继续、压缩、修改指令、模式和模型，可以关闭', async () => {
  const id = await open(history(['只读'], {}));
  const rejected = '该会话为只读历史';
  await expect(app.execute({ method: 'prompt', input: { id, text: '继续' } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'instructions', input: { id, entries: builtin } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'mode', input: { id, mode: 'direct' } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'model', input: { id, model } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'cancel', input: { id } })).rejects.toThrow(rejected);
  await expect(app.execute({ method: 'compact', input: { id } })).rejects.toThrow(rejected);
  expect(app.liveSession(id)).toBeUndefined();
  await app.execute({ method: 'close', input: { id } });
  expect(app.snapshot().sessions).toEqual([]);
});

it('损坏的 JSONL 只读打开，标出坏行位置并显示可解析的消息，原件保持不变', async () => {
  const input = history(['第一段', '第二段']);
  const lines = (await readFile(input.file, 'utf8')).split('\n');
  // 第 4 行插入坏行，最后追加未写完的行。
  lines.splice(3, 0, '{坏行');
  const damaged = `${lines.join('\n')}{"type":"message"`;
  await writeFile(input.file, damaged, 'utf8');
  const id = await open(input);
  expect(view(id)).toMatchObject({
    instructions: [],
    readonly: { reason: 'damaged', lines: [4, lines.length] },
    messages: [{ text: '第一段' }, { text: '第二段' }]
  });
  expect(await readFile(input.file, 'utf8')).toBe(damaged);
});

it('无效的指令记录按损坏历史只读打开', async () => {
  const id = await open(history(['记录无效'], { entries: [entry('空', 'system', ' ')], mode: 'review' }));
  expect(view(id).readonly).toMatchObject({ reason: 'damaged', lines: [] });
  expect(view(id).messages).toMatchObject([{ text: '记录无效' }]);
});

it('重载期间再次修改指令，在下一次发送生效而不是被丢弃', async () => {
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

  await app.execute({ method: 'instructions', input: { id, entries: [entry('一', 'system', '第一次修改')] } });
  const first = settled();
  await app.execute({ method: 'prompt', input: { id, text: '第一次发送' } });
  await app.execute({ method: 'instructions', input: { id, entries: [entry('二', 'system', '重载期间再次修改')] } });
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
