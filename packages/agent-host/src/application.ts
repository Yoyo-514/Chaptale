import {
  type AgentSession,
  type AgentSessionEvent,
  type ModelRuntime,
  SessionManager,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';

import {
  type Approval,
  type ChatMessage,
  type HostChange,
  type HostCommand,
  type HostEvent,
  type HostState,
  type ModelChoice,
  promptEntryType,
  type ProviderInput,
  type SessionView
} from './protocol.ts';
import { HostSessionPool } from './session-pool.ts';
import { openHostSessionManager } from './session-storage.ts';
import type { HostToolAuthorizer, HostToolDecision } from './tool-access.ts';

export interface HostApplicationOptions {
  cwd: string;
  agentDir: string;
  sessionDir: string;
  modelRuntime: ModelRuntime;
  defaultSystemPrompt: string;
  saveDefaultSystemPrompt: (text: string) => Promise<void>;
  configureModel: (input: ProviderInput) => Promise<void>;
  tools: (cwd: string) => ToolDefinition[];
}

interface OpenSession {
  session: AgentSession;
  view: SessionView;
  unsubscribe: () => void;
  promptDirty: boolean;
  promptSettings: { text: string };
  cancelled: boolean;
  operation?: Promise<void>;
}

/** 只投影界面需要的消息内容，不跨桥接复制 SDK、模型配置或媒体原件。 */
function messageView(message: AgentSession['messages'][number]): ChatMessage {
  const view: ChatMessage = { role: message.role, text: '', thinking: '', tools: [] };
  if ('toolName' in message) view.toolName = message.toolName;
  if ('isError' in message) view.error = message.isError;
  if (!('content' in message)) return view;
  if (typeof message.content === 'string') {
    view.text = message.content;
    return view;
  }
  for (const block of message.content) {
    if (block.type === 'text') view.text += block.text;
    else if (block.type === 'thinking') view.thinking += block.thinking;
    else if (block.type === 'toolCall') view.tools.push({ id: block.id, name: block.name, input: block.arguments });
    else if (block.type === 'image') view.text += '\n[图片内容；当前会话界面尚不提供附件预览]\n';
  }
  return view;
}

/**
 * 正式宿主的有限命令入口与界面投影。
 * 会话/工具执行仍由原生 SDK 持有；重连读取快照，不重发 prompt。
 */
export class HostApplication {
  private readonly sessions = new Map<string, OpenSession>();
  private readonly approvals = new Map<
    string,
    {
      value: Approval;
      finish: (decision: HostToolDecision) => void;
    }
  >();
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private cursor = 0;
  private stopping = false;
  private defaultSystemPrompt: string;
  private readonly opening = new Map<string, Promise<string>>();

  private readonly options: HostApplicationOptions;
  private readonly pool: HostSessionPool;

  private constructor(options: HostApplicationOptions, pool: HostSessionPool) {
    this.options = options;
    this.pool = pool;
    this.defaultSystemPrompt = options.defaultSystemPrompt;
  }

  static async create(options: HostApplicationOptions): Promise<HostApplication> {
    return new HostApplication(options, await HostSessionPool.create(options));
  }

  subscribe(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(change: HostChange): void {
    const event = { ...change, cursor: ++this.cursor };
    for (const listener of this.listeners) listener(structuredClone(event));
  }

  private models(): ModelChoice[] {
    return this.options.modelRuntime.getAvailableSnapshot().map(({ provider, id, name }) => ({ provider, id, name }));
  }

  snapshot(): HostState {
    return structuredClone({
      cursor: this.cursor,
      defaultSystemPrompt: this.defaultSystemPrompt,
      models: this.models(),
      sessions: [...this.sessions.values()].map(({ view }) => view),
      approvals: [...this.approvals.values()].map(({ value }) => value),
      cwd: this.options.cwd,
      tools: this.options.tools(this.options.cwd).map(tool => tool.name)
    });
  }

  async execute(command: HostCommand): Promise<unknown> {
    if (this.stopping) throw new Error('Agent 宿主已停止');
    switch (command.method) {
      case 'state':
        return this.snapshot();
      case 'create':
        return this.create(command.input.model);
      case 'open':
        return this.open(command.input.file, command.input.cwd);
      case 'history':
        return (await SessionManager.list(this.options.cwd, this.options.sessionDir)).map(item => ({
          id: item.id,
          file: item.path,
          cwd: item.cwd,
          title: item.name || item.firstMessage || '未命名会话',
          modified: item.modified.toISOString()
        }));
      case 'prompt':
        return this.prompt(command.input.id, command.input.text);
      case 'cancel': {
        const record = this.get(command.input.id);
        record.cancelled = true;
        await record.session.abort();
        await record.operation;
        return;
      }
      case 'close': {
        const record = this.get(command.input.id);
        this.sessions.delete(command.input.id);
        record.cancelled = true;
        await record.session.abort();
        await record.operation;
        await this.pool.close(command.input.id);
        record.unsubscribe();
        this.emit({ kind: 'closed', id: command.input.id });
        return;
      }
      case 'approve': {
        const request = this.approvals.get(command.input.id);
        if (!request) throw new Error('授权请求已结束，请查看当前状态');
        request.finish({ allow: command.input.allow });
        return;
      }
      case 'model': {
        const record = this.get(command.input.id);
        if (record.view.running) throw new Error('请在当前请求结束后切换模型');
        const model = this.options.modelRuntime.getModel(command.input.model.provider, command.input.model.id);
        if (!model) throw new Error('所选模型不可用');
        await record.session.setModel(model);
        record.view.model = { provider: model.provider, id: model.id };
        this.emit({ kind: 'session', session: record.view });
        return;
      }
      case 'systemPrompt': {
        if (!command.input.text.trim()) throw new Error('系统提示词不能为空');
        const record = this.get(command.input.id);
        record.view.systemPrompt = command.input.text;
        record.promptDirty = true;
        record.session.sessionManager.appendCustomEntry(promptEntryType, { text: command.input.text });
        this.emit({ kind: 'session', session: record.view });
        return;
      }
      case 'defaultSystemPrompt':
        if (!command.input.text.trim()) throw new Error('默认系统提示词不能为空');
        await this.options.saveDefaultSystemPrompt(command.input.text);
        this.defaultSystemPrompt = command.input.text;
        this.emit({ kind: 'default-prompt', text: this.defaultSystemPrompt });
        return;
      case 'configure':
        await this.options.configureModel(command.input);
        this.emit({ kind: 'models', models: this.models() });
        return;
    }
  }

  private get(id: string): OpenSession {
    const record = this.sessions.get(id);
    if (!record) throw new Error('会话未打开，请重新选择历史会话');
    return record;
  }

  /** 按会话 id 取原生会话，供平台宿主在命令之外直接使用 SDK 能力；不新建也不取消执行者。 */
  liveSession(id: string): AgentSession | undefined {
    return this.sessions.get(id)?.session;
  }

  private async create(model: { provider: string; id: string }): Promise<string> {
    const settings = { text: this.defaultSystemPrompt };
    if (!settings.text.trim()) throw new Error('请先在应用设置中配置默认系统提示词');
    const { session } = await this.pool.createSession({
      cwd: this.options.cwd,
      model,
      systemPrompt: () => settings.text,
      toolAccess: { tools: this.options.tools(this.options.cwd), authorize: this.authorize }
    });
    session.sessionManager.appendCustomEntry(promptEntryType, { text: settings.text });
    return this.attach(session, settings);
  }

  private open(file: string, cwd: string): Promise<string> {
    const existing = [...this.sessions.values()].find(record => record.view.file === file);
    if (existing) return Promise.resolve(existing.view.id);
    const pending = this.opening.get(file);
    if (pending) return pending;
    const operation = this.openFile(file, cwd);
    this.opening.set(file, operation);
    const finished = () => {
      this.opening.delete(file);
    };
    void operation.then(finished, finished);
    return operation;
  }

  private async openFile(file: string, cwd: string): Promise<string> {
    const manager = await openHostSessionManager({ file, cwd });
    const branch = manager.getBranch();
    let text: string | undefined;
    for (let index = branch.length - 1; index >= 0; index--) {
      const entry = branch[index];
      if (entry.type === 'custom' && entry.customType === promptEntryType) {
        text = (entry.data as { text: string }).text;
        break;
      }
    }
    if (text === undefined) throw new Error('历史未保存应用系统提示词，不能用当前默认值替代');
    const settings = { text };
    const { session } = await this.pool.openSession({
      file,
      cwd,
      systemPrompt: () => settings.text,
      toolAccess: { tools: this.options.tools(cwd), authorize: this.authorize }
    });
    return this.attach(session, settings);
  }

  private attach(session: AgentSession, settings: { text: string }): string {
    const view: SessionView = {
      id: session.sessionId,
      file: session.sessionFile!,
      cwd: session.sessionManager.getCwd(),
      model: session.model && { provider: session.model.provider, id: session.model.id },
      running: false,
      systemPrompt: settings.text,
      messages: session.messages.map(messageView)
    };
    const record: OpenSession = {
      session,
      view,
      promptDirty: false,
      promptSettings: settings,
      cancelled: false,
      unsubscribe: session.subscribe(event => this.onSessionEvent(record, event))
    };
    this.sessions.set(session.sessionId, record);
    this.emit({ kind: 'session', session: view });
    return session.sessionId;
  }

  private prompt(id: string, text: string): void {
    const record = this.get(id);
    if (record.view.running) throw new Error('该会话正在运行，请等待结束或停止后再发送');
    if (!text.trim()) throw new Error('消息不能为空');
    record.cancelled = false;
    record.view.running = true;
    delete record.view.error;
    this.emit({ kind: 'running', id, running: true });
    record.operation = (async () => {
      try {
        if (record.promptDirty) {
          const nextPrompt = record.view.systemPrompt;
          record.promptSettings.text = nextPrompt;
          await record.session.reload();
          // reload() 期间界面仍可能提交新的提示词；若已变化就保留脏标记，等下一次发送再应用。
          record.promptDirty = record.view.systemPrompt !== nextPrompt;
        }
        if (!record.cancelled) await record.session.prompt(text);
      } catch {
        record.view.error = '本次请求未完成，请检查模型设置或连接后重新发送';
      } finally {
        record.view.running = false;
        this.emit({ kind: 'running', id, running: false, error: record.view.error });
      }
    })();
  }

  private onSessionEvent(record: OpenSession, event: AgentSessionEvent): void {
    const { view } = record;
    if (event.type === 'message_start') {
      const message = messageView(event.message);
      const index = view.messages.push(message) - 1;
      this.emit({ kind: 'message', id: view.id, index, message });
    } else if (event.type === 'message_update') {
      const delta = event.assistantMessageEvent;
      if (delta.type !== 'text_delta' && delta.type !== 'thinking_delta') return;
      const index = view.messages.length - 1;
      const field = delta.type === 'text_delta' ? 'text' : 'thinking';
      view.messages[index][field] += delta.delta;
      this.emit({ kind: 'delta', id: view.id, index, field, text: delta.delta });
    } else if (event.type === 'message_end') {
      const index = view.messages.length - 1;
      const message = messageView(event.message);
      view.messages[index] = message;
      this.emit({ kind: 'message', id: view.id, index, message });
    }
  }

  private readonly authorize: HostToolAuthorizer = (request, signal) =>
    new Promise(resolve => {
      const id = randomUUID();
      const value: Approval = { id, ...request };
      const finish = (decision: HostToolDecision) => {
        signal?.removeEventListener('abort', cancelled);
        this.approvals.delete(id);
        this.emit({ kind: 'approval-closed', id });
        resolve(decision);
      };
      const cancelled = () => finish({ allow: false, reason: '调用已取消' });
      signal?.addEventListener('abort', cancelled, { once: true });
      this.approvals.set(id, { value, finish });
      this.emit({ kind: 'approval', approval: value });
    });

  async dispose(): Promise<void> {
    this.stopping = true;
    for (const record of this.sessions.values()) record.cancelled = true;
    await Promise.all(
      [...this.sessions.values()].map(async record => {
        await record.session.abort();
        return record.operation;
      })
    );
    await this.pool.dispose();
    for (const record of this.sessions.values()) record.unsubscribe();
    this.sessions.clear();
    this.listeners.clear();
  }
}
