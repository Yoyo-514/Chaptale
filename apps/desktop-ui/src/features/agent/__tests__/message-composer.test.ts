import { createAssistantMessageEventStream, InMemoryCredentialStore } from '@earendil-works/pi-ai';
import { ModelRuntime } from '@earendil-works/pi-coding-agent';
import { flushPromises, mount } from '@vue/test-utils';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, expect, it } from 'vitest';

import { HostModelConfiguration } from '@chaptale/agent-host';
import { HostApplication } from '@chaptale/agent-host/application';
import type { HostCommand, HostCommands, SessionView } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { ChaptaleDesktopApi } from '@chaptale/desktop/bridge';
import { openCreationStorage } from '@chaptale/storage';

import MessageComposer from '../components/MessageComposer.vue';
import MessageList from '../components/MessageList.vue';
import { useAgentStore } from '../store';

let wrapper: ReturnType<typeof mount>;
afterEach(() => {
  wrapper?.unmount();
  localStorage.clear();
});

it('压缩期间保留草稿并禁用发送和切换模型，停止按钮明确指向压缩', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const agent = useAgentStore();
  const session: SessionView = {
    id: 'session',
    sessionId: 'session',
    file: 'history.jsonl',
    workId: null,
    running: true,
    compacting: true,
    instructions: [],
    mode: 'review',
    messages: [],
    model: { provider: 'offline', id: 'model' }
  };
  agent.state = {
    cursor: 1,
    tools: [],
    approvals: [],
    sessions: [session],
    models: [{ provider: 'offline', id: 'model', name: '离线模型' }],
    settings: {
      defaultInstructions: [],
      defaultMode: 'review',
      lastModel: null,
      namedInstructions: [],
      toolPermissions: []
    }
  };
  agent.connected = true;
  agent.activeId = session.id;
  agent.draft = '继续创作的草稿';
  wrapper = mount(MessageComposer, { global: { plugins: [pinia] } });
  expect(wrapper.get('[role="status"]').text()).toBe('正在压缩…');
  expect(wrapper.get('button[aria-label="停止压缩"]').attributes('disabled')).toBeUndefined();
  expect(wrapper.find('button[type="submit"]').exists()).toBe(false);
  expect(wrapper.get('[aria-label="会话模型"]').attributes('disabled')).toBeDefined();
  await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
  await flushPromises();
  expect(agent.draft).toBe('继续创作的草稿');
  agent.state.sessions[0].compacting = false;
  await flushPromises();
  expect(wrapper.find('button[aria-label="稍后处理"]').exists()).toBe(true);
  expect(wrapper.find('button[aria-label="立即插话"]').exists()).toBe(true);
  expect(wrapper.find('button[aria-label="停止生成"]').exists()).toBe(true);
  expect(wrapper.get('textarea').attributes('placeholder')).toContain('Ctrl + Enter 插话');
  expect(wrapper.get('textarea').attributes('placeholder')).toContain('Ctrl + Shift + Enter 稍后处理');
  agent.draft = '';
  await flushPromises();
  expect(wrapper.find('button[aria-label="稍后处理"]').exists()).toBe(false);
  expect(wrapper.find('button[aria-label="立即插话"]').exists()).toBe(false);
  expect(wrapper.find('button[aria-label="停止生成"]').exists()).toBe(true);
  agent.draft = '继续创作的草稿';
  agent.state.sessions[0].running = false;
  await flushPromises();
  expect(wrapper.find('[role="status"]').exists()).toBe(false);
  expect(wrapper.get('button[type="submit"]').attributes('disabled')).toBeUndefined();
  expect(wrapper.get('[aria-label="会话模型"]').attributes('disabled')).toBeUndefined();
});

it('引用到对话显示待发选区芯片并聚焦输入框，移除或发送后清理芯片', async () => {
  const pinia = createPinia();
  setActivePinia(pinia);
  const agent = useAgentStore();
  const session: SessionView = {
    id: 'session',
    sessionId: 'session',
    file: 'history.jsonl',
    workId: 'work-1',
    running: false,
    compacting: false,
    instructions: [],
    mode: 'review',
    messages: [],
    model: { provider: 'offline', id: 'model' }
  };
  agent.state = {
    cursor: 1,
    tools: [],
    approvals: [],
    sessions: [session],
    models: [{ provider: 'offline', id: 'model', name: '离线模型' }],
    settings: {
      defaultInstructions: [],
      defaultMode: 'review',
      lastModel: null,
      namedInstructions: [],
      toolPermissions: []
    }
  };
  agent.connected = true;
  agent.activeId = session.id;
  wrapper = mount(MessageComposer, { attachTo: document.body, global: { plugins: [pinia] } });

  const quote = {
    workId: 'work-1',
    entryId: 'doc-3',
    title: '第三回',
    section: 'manuscript' as const,
    selection: '北风卷起残雪，灯火微摇。'
  };
  agent.quoteSelection(quote);
  await flushPromises();

  expect(wrapper.get('[aria-label="文稿《第三回》选区"]').text()).toContain('北风卷起残雪，灯火微摇。');
  expect(document.activeElement).toBe(wrapper.get('textarea').element);

  await wrapper.get('button[aria-label="移除引用"]').trigger('click');
  expect(wrapper.find('[aria-label="文稿《第三回》选区"]').exists()).toBe(false);

  agent.quoteSelection(quote);
  await flushPromises();
  expect(wrapper.find('[aria-label="文稿《第三回》选区"]').exists()).toBe(true);
  agent.clearQuote();
  await flushPromises();
  expect(wrapper.find('[aria-label="文稿《第三回》选区"]').exists()).toBe(false);
});

it('生成中支持快捷键与按钮分别发送插话或稍后处理，并可从底部排队气泡撤回重改', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-composer-queue-'));
  for (const part of ['agent', 'sessions', 'work', 'data']) await mkdir(join(root, part));
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false
  });
  const model = { provider: 'queue-test', id: 'offline' };
  let markStarted!: () => void;
  const started = new Promise<void>(resolve => {
    markStarted = resolve;
  });
  runtime.registerProvider(model.provider, {
    baseUrl: 'http://127.0.0.1:9',
    api: 'queue-test',
    apiKey: 'offline-test',
    models: [
      {
        id: model.id,
        name: '离线排队测试',
        reasoning: false,
        input: ['text'],
        contextWindow: 8192,
        maxTokens: 512,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
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
              usage: {
                input: 0,
                output: 0,
                cacheRead: 0,
                cacheWrite: 0,
                totalTokens: 0,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
              },
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
  const author = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  const host = await HostApplication.create({
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'data', 'settings.json'),
    builtinInstructions: [{ name: '默认', role: 'system', text: '离线测试指令', enabled: true }],
    modelRuntime: runtime,
    modelConfiguration: new HostModelConfiguration(join(root, 'config'), runtime),
    creation: author,
    tools: () => []
  });
  const agentClient: ChaptaleDesktopApi['agentHost'] = {
    request: <K extends keyof HostCommands>(method: K, input: HostCommands[K]['input']) =>
      host.execute({ method, input: structuredClone(input) } as HostCommand) as Promise<HostCommands[K]['output']>,
    subscribe: listener => host.subscribe(listener),
    onDisconnected: () => () => {}
  };
  const creationClient = {
    request: (method: string, input: unknown) => author.execute({ method, input } as never),
    subscribe: (listener: (event: unknown) => void) => author.subscribe(listener as never),
    onDisconnected: () => () => {}
  };
  Object.defineProperty(window, 'chaptaleDesktop', {
    configurable: true,
    value: { agentHost: agentClient, creation: creationClient }
  });

  try {
    const pinia = createPinia();
    setActivePinia(pinia);
    const agent = useAgentStore();
    await agent.connect();
    agent.selectedModel = model;
    const id = (await host.execute({ method: 'create', input: { model, workId: null } })) as string;
    await agent.select(id);
    await host.execute({ method: 'prompt', input: { id, text: '先写第一回' } });
    await started;
    await flushPromises();

    wrapper = mount(MessageComposer, { attachTo: document.body, global: { plugins: [pinia] } });
    agent.draft = '先改这一段语气';
    await flushPromises();
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true });
    await flushPromises();
    expect(agent.active?.queued).toEqual([{ delivery: 'steer', text: '先改这一段语气', editorContext: undefined }]);

    const quote = {
      workId: 'work-1',
      entryId: 'doc-1',
      title: '第一回',
      section: 'manuscript' as const,
      selection: '残月如钩'
    };
    agent.quoteSelection(quote);
    agent.draft = '写完后补人物设定';
    await flushPromises();
    await wrapper.get('textarea').trigger('keydown', { key: 'Enter', ctrlKey: true, shiftKey: true });
    await flushPromises();
    expect(agent.active?.queued).toEqual([
      { delivery: 'steer', text: '先改这一段语气', editorContext: undefined },
      { delivery: 'followUp', text: '写完后补人物设定', editorContext: quote }
    ]);
    expect(agent.activeOutgoing).toEqual([]);

    const listWrapper = mount(MessageList, {
      props: { session: agent.active!, approvals: [], outgoing: agent.activeOutgoing },
      global: { plugins: [pinia] }
    });
    const queuedCards = listWrapper.findAll('[aria-label="作者排队消息"]');
    expect(queuedCards).toHaveLength(2);
    expect(queuedCards[0]?.text()).toContain('插话排队中');
    expect(queuedCards[1]?.text()).toContain('稍后处理排队中');
    await queuedCards[1]!.get('button.agent-queue-recall').trigger('click');
    const emitted = listWrapper.emitted('recallQueued');
    expect(emitted?.[0]).toEqual(['followUp', 1]);
    listWrapper.unmount();

    await agent.recallQueued('followUp', 1);
    await flushPromises();
    expect(agent.active?.queued).toEqual([{ delivery: 'steer', text: '先改这一段语气', editorContext: undefined }]);
    expect(agent.draft).toBe('写完后补人物设定');
    expect(agent.quotedSelection).toEqual(quote);

    await host.execute({ method: 'cancel', input: { id } });
  } finally {
    await host.dispose();
    author.close();
    await rm(root, { recursive: true, force: true });
  }
});

it('输入 / 搜索当前范围已启用技能（含仅手动调用项），支持中文描述过滤、键盘选择与 Esc 收起', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-composer-skills-'));
  for (const part of ['agent', 'sessions', 'work', 'data']) await mkdir(join(root, part));
  const runtime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    allowModelNetwork: false,
    refreshOnCreate: false
  });
  const model = { provider: 'skill-test', id: 'offline' };
  runtime.registerProvider(model.provider, {
    baseUrl: 'http://127.0.0.1:9',
    api: 'skill-test',
    apiKey: 'offline-test',
    models: [
      {
        id: model.id,
        name: '离线技能模型',
        reasoning: false,
        input: ['text'],
        contextWindow: 8192,
        maxTokens: 512,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ]
  });
  const author = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  const host = await HostApplication.create({
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'data', 'settings.json'),
    builtinInstructions: [{ name: '默认', role: 'system', text: '离线测试指令', enabled: true }],
    modelRuntime: runtime,
    modelConfiguration: new HostModelConfiguration(join(root, 'config'), runtime),
    creation: author,
    tools: () => []
  });
  await host.execute({
    method: 'createSkill',
    input: { scope: 'global', workId: null, name: 'polish', description: '古风对白润色规范' }
  });
  await host.execute({
    method: 'createSkill',
    input: {
      scope: 'global',
      workId: null,
      name: 'audit-plot',
      description: '暗线伏笔一致性检查',
      disableModelInvocation: true
    }
  });
  await host.execute({
    method: 'createSkill',
    input: { scope: 'global', workId: null, name: 'disabled-one', description: '停用技能不应出现' }
  });
  await host.execute({
    method: 'setSkillEnabled',
    input: { scope: 'global', workId: null, name: 'disabled-one', enabled: false }
  });

  const agentClient: ChaptaleDesktopApi['agentHost'] = {
    request: <K extends keyof HostCommands>(method: K, input: HostCommands[K]['input']) =>
      host.execute({ method, input: structuredClone(input) } as HostCommand) as Promise<HostCommands[K]['output']>,
    subscribe: listener => host.subscribe(listener),
    onDisconnected: () => () => {}
  };
  const creationClient = {
    request: (method: string, input: unknown) => author.execute({ method, input } as never),
    subscribe: (listener: (event: unknown) => void) => author.subscribe(listener as never),
    onDisconnected: () => () => {}
  };
  Object.defineProperty(window, 'chaptaleDesktop', {
    configurable: true,
    value: { agentHost: agentClient, creation: creationClient }
  });

  try {
    const pinia = createPinia();
    setActivePinia(pinia);
    const agent = useAgentStore();
    await agent.connect();
    agent.selectedModel = model;

    wrapper = mount(MessageComposer, { attachTo: document.body, global: { plugins: [pinia] } });

    // 新草稿输入 / 时列出已启用技能（包含 disable-model-invocation 手动技能，不含已停用项）
    await wrapper.get('textarea').setValue('/');
    await flushPromises();
    const listbox = wrapper.get('[role="listbox"][aria-label="可用技能"]');
    expect(listbox.text()).toContain('/skill:audit-plot');
    expect(listbox.text()).toContain('仅手动');
    expect(listbox.text()).toContain('/skill:polish');
    expect(listbox.text()).not.toContain('disabled-one');

    // 按 Esc 收起当前查询的补全浮层
    await wrapper.get('textarea').trigger('keydown', { key: 'Escape' });
    await flushPromises();
    expect(wrapper.find('[role="listbox"][aria-label="可用技能"]').exists()).toBe(false);

    // 继续按中文描述搜索，按 Enter 补全为 /skill:polish 并在后续空格后自动收起
    await wrapper.get('textarea').setValue('/古风');
    await flushPromises();
    const filtered = wrapper.findAll('[role="option"]');
    expect(filtered).toHaveLength(1);
    expect(filtered[0]!.text()).toContain('/skill:polish');

    await wrapper.get('textarea').trigger('keydown', { key: 'Enter' });
    await flushPromises();
    expect(agent.draft).toBe('/skill:polish ');
    expect(wrapper.find('[role="listbox"][aria-label="可用技能"]').exists()).toBe(false);
  } finally {
    await host.dispose();
    author.close();
    await rm(root, { recursive: true, force: true });
  }
});
