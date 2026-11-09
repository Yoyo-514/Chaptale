import { createAssistantMessageEventStream, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { flushPromises } from '@vue/test-utils';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { createPinia, disposePinia, setActivePinia, type Pinia } from 'pinia';
import { afterEach, beforeEach, expect, it } from 'vitest';

import { HostModelConfiguration } from '@chaptale/agent-host';
import { HostApplication, type HostApplicationOptions } from '@chaptale/agent-host/application';
import {
  instructionsEntryType,
  modeEntryType,
  type HostCommand,
  type HostCommands
} from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, Work } from '@chaptale/creation/contracts';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';
import { openCreationStorage } from '@chaptale/storage';

import { useCreationStore } from '@/features/creation';

import { useAgentStore } from '../store';

let root: string;
let host: HostApplication;
let author: CreationApplication;
let options: HostApplicationOptions;
let pinia: Pinia;
let creation: ReturnType<typeof useCreationStore>;
let agent: ReturnType<typeof useAgentStore>;
let works: Work[];
let started: Promise<void>;
let finish: (() => void) | undefined;
let delay: { method: string; wait: Promise<void> } | undefined;
const model = { provider: 'ownership-test', id: 'offline' };
const instructions = [{ name: '测试', role: 'system' as const, text: '离线会话归属测试', enabled: true }];
function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function front() {
  pinia = createPinia();
  setActivePinia(pinia);
  creation = useCreationStore();
  await creation.connect();
  await creation.openWork(works[0]!.id);
  agent = useAgentStore();
  agent.selectedModel = model;
}
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'chaptale-session-scopes-'));
  for (const part of ['agent', 'sessions', 'work', 'data']) await mkdir(join(root, part));
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false
  });
  let entered!: () => void;
  started = new Promise<void>(resolve => {
    entered = resolve;
  });
  finish = undefined;
  delay = undefined;
  runtime.registerProvider(model.provider, {
    baseUrl: 'http://127.0.0.1:9',
    api: 'ownership-test',
    apiKey: 'offline-test',
    models: [
      {
        id: model.id,
        name: '离线会话测试',
        reasoning: false,
        input: ['text'],
        contextWindow: 8192,
        maxTokens: 512,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    streamSimple: (target, _context, streamOptions) => {
      // 保持真实 SDK 请求运行，结束时只报告测试错误；全程不联网、不生成模型回复。
      const stream = createAssistantMessageEventStream();
      finish = () =>
        stream.push({
          type: 'error',
          reason: 'error',
          error: {
            role: 'assistant',
            content: [],
            api: target.api,
            provider: target.provider,
            model: target.id,
            usage: {
              input: 0,
              output: 0,
              cacheRead: 0,
              cacheWrite: 0,
              totalTokens: 0,
              cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
            },
            stopReason: 'error',
            errorMessage: '离线测试结束',
            timestamp: Date.now()
          }
        });
      streamOptions?.signal?.addEventListener('abort', finish, { once: true });
      entered();
      return stream;
    }
  });
  author = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  options = {
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'data', 'settings.json'),
    builtinInstructions: instructions,
    modelRuntime: runtime,
    modelConfiguration: new HostModelConfiguration(join(root, 'config'), runtime),
    creation: author,
    tools: () => []
  };
  host = await HostApplication.create(options);
  works = ['同名作品', '同名作品'].map(title =>
    value(
      author.executeAuthor({
        method: 'createWork',
        input: {
          commandId: crypto.randomUUID(),
          title,
          kind: 'novel'
        }
      })
    )
  );
  const agentClient: ChaptaleDesktopApi['agentHost'] = {
    async request<K extends keyof HostCommands>(
      method: K,
      input: HostCommands[K]['input']
    ): Promise<HostCommands[K]['output']> {
      if (delay?.method === method) await delay.wait;
      return host.execute({ method, input } as HostCommand) as Promise<HostCommands[K]['output']>;
    },
    subscribe: listener => host.subscribe(listener),
    onDisconnected: () => () => {}
  };
  const creationClient: Omit<
    ChaptaleDesktopApi['creation'],
    'selectPaths' | 'selectPackageSavePath' | 'fileAction' | 'readFile' | 'pathForFile' | 'addFileData'
  > = {
    request: (method, input) => author.execute({ method, input }),
    subscribe: listener => author.subscribe(listener),
    onDisconnected: () => () => {}
  };
  Object.defineProperty(window, 'chaptaleDesktop', {
    configurable: true,
    value: { agentHost: agentClient, creation: creationClient }
  });
  await front();
});
afterEach(async () => {
  finish?.();
  if (pinia) disposePinia(pinia);
  await host?.dispose();
  author?.close();
  Reflect.deleteProperty(window, 'chaptaleDesktop');
  await rm(root, { recursive: true, force: true });
});
/** 在归属目录中写入历史；workId 为 null 时写入未归属目录。 */
function history(text: string, complete = true, workId: string | null = null) {
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, workId ?? 'unassigned'));
  if (complete) {
    manager.appendCustomEntry(instructionsEntryType, { entries: instructions });
    manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  }
  manager.appendMessage({ role: 'user', content: text, timestamp: Date.now() });
  return {
    id: manager.getSessionId(),
    file: manager.getSessionFile()!,
    workId,
    title: text,
    modified: new Date().toISOString()
  };
}

it('同名作品各自归属并使用各自的文件目录，新建独立会话保留独立范围', async () => {
  await agent.connect();
  const a = (await agent.create())!;
  expect(agent.error).toBe('');
  expect(a).toEqual(expect.any(String));
  await creation.openWork(works[1]!.id);
  await flushPromises();
  const b = (await agent.create())!;
  await agent.newDraft(true);
  const independent = (await agent.create())!;
  const owners = Object.fromEntries(host.snapshot().sessions.map(session => [session.sessionId, session.workId]));
  expect(owners).toEqual({ [a]: works[0]!.id, [b]: works[1]!.id, [independent]: null });
  const cwds = [a, b, independent].map(id => host.liveSession(id)!.sessionManager.getCwd());
  expect(new Set(cwds).size).toBe(3);
  expect(cwds[2]).toBe(options.cwd);
  expect(agent.scope).toBeNull();
  expect(agent.recent.map(entry => entry.live?.sessionId)).toEqual([independent]);
  await creation.openWork(works[0]!.id);
  await flushPromises();
  expect(agent.active?.sessionId).toBe(a);
  expect(agent.recent.map(entry => entry.live?.sessionId)).toEqual([a]);
  expect(agent.entries.map(entry => entry.workId).sort()).toEqual([null, works[0]!.id, works[1]!.id].sort());
  await creation.openWork(works[1]!.id);
  await flushPromises();
  expect(agent.active?.sessionId).toBe(b);
});

it('新会话草稿沿用最近一次选择的模型', async () => {
  await agent.connect();
  await agent.create();
  expect(agent.error).toBe('');
  disposePinia(pinia);
  await front();
  agent.selectedModel = undefined;
  await agent.connect();
  await agent.newDraft();
  expect(agent.selectedModel).toEqual(model);
});

it('只读历史沿用原生身份归入作品，重启后恢复该作品最后查看的历史', async () => {
  const item = history('独立历史', false);
  await agent.connect();
  await agent.changeScope(null);
  expect(await agent.open(item)).toBe(true);
  expect(agent.active?.readonly?.reason).toBe('incomplete');
  expect(agent.active?.id).not.toBe(item.id);
  expect(agent.active?.sessionId).toBe(item.id);
  expect(await agent.assign(item.id)).toBe(true);
  expect(agent.error).toBe('');
  expect(agent.scope).toBe(works[0]!.id);
  // 归入即移动历史文件，原件内容不变。
  expect(agent.active?.file).toBe(join(options.sessionDir, works[0]!.id, basename(item.file)));
  expect(agent.entries.find(entry => entry.key === item.id)?.workId).toBe(works[0]!.id);
  await creation.persistState();
  disposePinia(pinia);
  await host.dispose();
  author.close();
  author = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  host = await HostApplication.create({ ...options, creation: author });
  await front();
  await agent.connect();
  expect(agent.active?.sessionId).toBe(item.id);
  expect(agent.active?.readonly?.reason).toBe('incomplete');
  expect(agent.active?.messages[0]?.text).toBe('独立历史');

  // 宿主拒收的消息留在列表中标为失败，重试仍只保留一条，可移除。
  agent.draft = '还能继续吗';
  await agent.send();
  expect(agent.draft).toBe('');
  expect(agent.activeOutgoing).toMatchObject([{ text: '还能继续吗', error: expect.stringContaining('只读历史') }]);
  await agent.retryOutgoing(agent.activeOutgoing[0]!.key);
  expect(agent.activeOutgoing).toMatchObject([{ text: '还能继续吗', error: expect.stringContaining('只读历史') }]);
  agent.discardOutgoing(agent.activeOutgoing[0]!.key);
  expect(agent.activeOutgoing).toEqual([]);
});

it('切换作品仅改变查看范围，真实 SDK 正在执行的请求继续运行', async () => {
  await agent.connect();
  agent.draft = '检查会话运行归属';
  await agent.send();
  expect(agent.error).toBe('');
  expect(agent.activeId).toEqual(expect.any(String));
  await started;
  // 宿主写入作者消息后，乐观显示的消息让位给真实记录。
  await expect.poll(() => agent.activeOutgoing).toEqual([]);
  expect(agent.active?.messages.filter(message => message.role === 'user').map(message => message.text)).toEqual([
    '检查会话运行归属'
  ]);
  const id = agent.activeId!;
  const executor = host.liveSession(id);
  expect(host.snapshot().sessions.find(session => session.id === id)?.running).toBe(true);
  await creation.openWork(works[1]!.id);
  await flushPromises();
  expect(agent.active).toBeUndefined();
  expect(host.snapshot().sessions.find(session => session.id === id)?.running).toBe(true);
  expect(host.liveSession(id)).toBe(executor);
  await creation.openWork(works[0]!.id);
  await flushPromises();
  expect(agent.activeId).toBe(id);
  expect(agent.active?.running).toBe(true);
});

it('创建期间切换作品，迟到的新会话仍归原作品且保持当前查看位置', async () => {
  const current = history('作品乙的会话', true, works[1]!.id);
  value(author.executeAuthor({ method: 'selectSession', input: { workId: works[1]!.id, sessionId: current.id } }));
  await agent.connect();
  let release!: () => void;
  delay = {
    method: 'create',
    wait: new Promise<void>(resolve => {
      release = resolve;
    })
  };
  agent.draft = '作品甲的草稿';
  const pending = agent.create();
  await creation.openWork(works[1]!.id);
  await expect.poll(() => agent.active?.sessionId).toBe(current.id);
  release();
  const created = (await pending)!;
  expect(agent.error).toBe('');
  expect(created).toEqual(expect.any(String));
  expect(agent.scope).toBe(works[1]!.id);
  expect(agent.active?.sessionId).toBe(current.id);
  const view = host.snapshot().sessions.find(session => session.sessionId === created)!;
  expect(view.workId).toBe(works[0]!.id);
  expect(dirname(view.file)).toBe(join(options.sessionDir, works[0]!.id));
  await creation.openWork(works[0]!.id);
  await flushPromises();
  expect(agent.active?.sessionId).toBe(created);
  expect(agent.draft).toBe('作品甲的草稿');
});
