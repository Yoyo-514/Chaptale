import { createAssistantMessageEventStream, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { flushPromises, mount, type VueWrapper } from '@vue/test-utils';
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
import { useEditorContext, useEditorStore } from '@/features/editor';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';

import MessageList from '../components/MessageList.vue';
import SessionPanel from '../SessionPanel.vue';
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
let rejectPrompt: boolean;
let wrappers: VueWrapper[];
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
  agent.setEditorContextSource(useEditorContext());
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
  rejectPrompt = false;
  wrappers = [];
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
      if (method === 'prompt' && rejectPrompt) throw new Error('离线传输失败');
      return host.execute({ method, input: structuredClone(input) } as HostCommand) as Promise<
        HostCommands[K]['output']
      >;
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
  for (const wrapper of wrappers) wrapper.unmount();
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

it('点击发送时捕获焦点与选区，新建会话期间切页和后续输入保持各自内容', async () => {
  await agent.connect();
  const entries = ['第三回', '第四回'].map(title =>
    value(
      author.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: crypto.randomUUID(),
          workId: works[0]!.id,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title,
          format: 'txt',
          content: '原文\r\n第二行'
        }
      })
    )
  );
  await flushPromises();
  expect(creation.entries.map(entry => entry.id)).toContain(entries[0]!.id);
  const editor = useEditorStore();
  await editor.openDocument(entries[0]!.id);
  expect(editor.tabs[0]).toMatchObject({ status: 'ready', error: '' });
  const buffer = editor.getBuffer(entries[0]!.id)!;
  buffer.update(
    buffer.state.update({ changes: { from: 0, to: 2, insert: '手改' }, selection: { anchor: 0, head: 2 } }).state
  );
  editor.updateBuffer(entries[0]!.id, buffer);
  let release!: () => void;
  delay = {
    method: 'create',
    wait: new Promise<void>(resolve => {
      release = resolve;
    })
  };
  agent.draft = '润色这里';
  const sending = agent.send();
  await flushPromises();
  expect(editor.unsavedPrompt).toEqual({ titles: ['第三回'], discard: false });
  editor.resolveUnsaved('save');
  await flushPromises();
  await editor.openDocument(entries[1]!.id);
  buffer.update(buffer.state.update({ changes: { from: buffer.state.doc.length, insert: '发送后的输入' } }).state);
  editor.updateBuffer(entries[0]!.id, buffer);
  release();
  await sending;
  await started;
  const sent = host
    .snapshot()
    .sessions.find(session => session.id === agent.activeId)!
    .messages.find(message => message.role === 'user')!;
  expect(sent.editorContext).toEqual({
    workId: works[0]!.id,
    entryId: entries[0]!.id,
    title: '第三回',
    section: 'manuscript',
    selection: '手改'
  });
  expect(
    value(author.executeAuthor({ method: 'readDocument', input: { workId: works[0]!.id, documentId: entries[0]!.id } }))
      .content
  ).toBe('手改\r\n第二行');
  expect(editor.getBuffer(entries[0]!.id)!.content).toContain('发送后的输入');
  expect(editor.tabs.find(tab => tab.id === entries[0]!.id)!.dirty).toBe(true);
});

it('失败重试与历史标记沿用原消息发送时的标签与选区', async () => {
  await agent.connect();
  const entries = ['第三回', '第四回'].map(title =>
    value(
      author.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: crypto.randomUUID(),
          workId: works[0]!.id,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title,
          format: 'txt',
          content: '正式正文'
        }
      })
    )
  );
  await flushPromises();
  const editor = useEditorStore();
  await editor.openDocument(entries[0]!.id);
  const buffer = editor.getBuffer(entries[0]!.id)!;
  buffer.update(buffer.state.update({ selection: { anchor: 0, head: 2 } }).state);
  rejectPrompt = true;
  agent.draft = '继续润色';
  await agent.send();
  const failed = agent.activeOutgoing[0];
  expect(failed.error).toContain('离线传输失败');
  buffer.replaceContent('失败后继续输入');
  editor.updateBuffer(entries[0]!.id, buffer);
  await editor.openDocument(entries[1]!.id);
  await flushPromises();
  rejectPrompt = false;
  await agent.retryOutgoing(failed.key);
  await started;
  const session = host.snapshot().sessions.find(item => item.id === agent.activeId)!;
  const sent = session.messages.find(message => message.role === 'user')!;
  expect(sent.editorContext).toEqual({
    workId: works[0]!.id,
    entryId: entries[0]!.id,
    title: '第三回',
    section: 'manuscript',
    selection: '正式'
  });
  const transcript = mount(MessageList, { props: { session, approvals: [], outgoing: [] } });
  wrappers.push(transcript);
  expect(transcript.get('[aria-label="编辑上下文"]').text()).toContain('文稿《第三回》选区');
});

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

it('本章提取新建作品审阅会话，携带资料规则并保留作者已有指令', async () => {
  await host.execute({ method: 'defaultMode', input: { mode: 'direct' } });
  await agent.connect();
  const previous = (await agent.create())!;
  expect(agent.error).toBe('');
  const chapter = value(
    author.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: crypto.randomUUID(),
        workId: works[0]!.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '渡口',
        format: 'txt',
        content: '沈霁在渡口救下柳七。'
      }
    })
  );
  const navigation = useWorkbenchStore();
  navigation.agentInMain = true;
  navigation.agentView = 'settings';
  navigation.focusMode = true;
  await agent.extractChapter(chapter);
  expect(agent.error).toBe('');
  await started;
  const current = agent.active!;
  expect(current.sessionId).not.toBe(previous);
  expect(current.workId).toBe(works[0]!.id);
  expect(current.mode).toBe('review');
  expect(current.instructions).toEqual(instructions);
  expect(host.snapshot().settings.defaultInstructions).toEqual(instructions);
  expect(host.snapshot().sessions.find(session => session.id === previous)?.mode).toBe('direct');
  expect(navigation.auxiliaryOpen).toBe(true);
  expect(navigation.agentInMain).toBe(false);
  expect(navigation.agentView).toBe('chat');
  expect(navigation.focusMode).toBe(false);
  const messages = current.messages.filter(message => message.role === 'user');
  expect(messages).toHaveLength(1);
  const prompt = messages[0]!.text;
  expect(prompt).toContain(chapter.title);
  expect(prompt).toContain(`条目 ID：${chapter.id}`);
  expect(prompt).toContain('attributes.type');
  expect(prompt).toContain('attributes.aliases');
  expect(prompt).toContain('跨章稳定');
  expect(prompt).toContain('原文明示');
  expect(prompt).toContain('已有资料正文');
  expect(prompt).toContain('移除候选');
  expect(prompt).toContain('work_relation_ls');
  expect(prompt).toContain('sourceRevisionId');
  expect(prompt).toContain('已有事件字段一致时保持原样');
  expect(prompt).toContain('在回复中说明对应规划');
  expect(prompt).toContain('规划《资料名》：原句');
  expect(prompt).toContain('codemode');
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

it('输入框上方提示条区分中性提示与错误、支持关闭同步宿主并在切换子视图时清理瞬时提示', async () => {
  const workbench = useWorkbenchStore();
  const settings = useSettingsStore();
  workbench.auxiliaryOpen = true;
  workbench.agentView = 'chat';
  await agent.connect();
  const id = await agent.create();
  expect(id).toEqual(expect.any(String));

  const panel = mount(SessionPanel, { global: { plugins: [pinia] } });
  wrappers.push(panel);
  await flushPromises();

  // 1. 新会话无对话内容时触发手动压缩：宿主通过 running 事件推送 noticeLevel: 'info'
  await agent.perform(() => host.execute({ method: 'compact', input: { id: id! } }));
  await expect.poll(() => agent.active?.error).toBe('对话内容较少，暂时无需压缩');
  expect(agent.active?.noticeLevel).toBe('info');
  await flushPromises();

  const infoBanner = panel.get('.agent-banner');
  expect(infoBanner.classes()).toContain('is-info');
  expect(infoBanner.text()).toContain('对话内容较少，暂时无需压缩');

  await infoBanner.get('button[aria-label="关闭提示"]').trigger('click');
  await flushPromises();
  expect(panel.find('.agent-banner').exists()).toBe(false);
  expect(host.snapshot().sessions.find(s => s.id === id)?.error).toBeUndefined();

  // 2. 面板瞬时错误显示为错误提示条，切换子视图时自动清理
  workbench.agentView = 'history';
  await flushPromises();
  agent.error = '有会话正在运行，停止后才能删除';
  await flushPromises();
  expect(panel.get('.agent-banner').classes()).toContain('is-error');
  workbench.agentView = 'chat';
  await flushPromises();
  expect(agent.error).toBe('');
  expect(panel.find('.agent-banner').exists()).toBe(false);

  // 3. 提示“请先选择模型”时附带“模型设置”快捷入口
  agent.error = '请先选择模型';
  await flushPromises();
  await panel
    .get('.agent-banner')
    .findAll('button')
    .find(btn => btn.text() === '模型设置')!
    .trigger('click');
  expect(settings.isOpen).toBe(true);
  expect(settings.activeSection).toBe('llm');
});
