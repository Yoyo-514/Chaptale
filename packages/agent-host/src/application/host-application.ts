import { type ModelRuntime, SessionManager, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';

import { normalizeInstructions, normalizeMode } from '../instructions/instructions.ts';
import {
  type AgentInstructions,
  type HostChange,
  type HostCommand,
  type HostEvent,
  type HostState,
  instructionsEntryType,
  type ModelChoice,
  type ModelRef,
  modeEntryType,
  type SessionView
} from '../protocol.ts';
import type { HostModelConfiguration } from '../runtime/model-configuration.ts';
import { HostSessionPool } from '../session/session-pool.ts';
import { HostSessionOpenError } from '../session/session-storage.ts';
import { AppSettingsStore } from '../settings/app-settings.ts';
import { ToolApprovals } from './approvals.ts';
import { damagedHistory, sessionHistory, type SessionHistory } from './history.ts';
import { type AppliedInstructions, instructionCallbacks, LiveSession } from './live-session.ts';

export interface HostApplicationOptions {
  cwd: string;
  agentDir: string;
  sessionDir: string;
  /** 应用数据目录下的设置文件绝对路径，不进作品备份。 */
  settingsFile: string;
  /** 作者尚未设置全局默认时，新会话复制的应用内置指令。 */
  builtinInstructions: AgentInstructions;
  modelRuntime: ModelRuntime;
  modelConfiguration: HostModelConfiguration;
  tools: (cwd: string) => ToolDefinition[];
}

/** 已打开的会话；只读历史只有视图，没有可继续的会话。 */
interface OpenSession {
  view: SessionView;
  live?: LiveSession;
}

/**
 * 正式宿主的有限命令入口与界面投影。
 * 会话/工具执行仍由原生 SDK 持有；重连读取快照，不重发 prompt。
 */
export class HostApplication {
  private readonly sessions = new Map<string, OpenSession>();
  private readonly opening = new Map<string, Promise<string>>();
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private readonly approvals = new ToolApprovals(change => this.emit(change));
  private cursor = 0;
  private stopping = false;

  private readonly options: HostApplicationOptions;
  private readonly pool: HostSessionPool;
  private readonly settings: AppSettingsStore;

  private constructor(options: HostApplicationOptions, pool: HostSessionPool, settings: AppSettingsStore) {
    this.options = options;
    this.pool = pool;
    this.settings = settings;
  }

  static async create(options: HostApplicationOptions): Promise<HostApplication> {
    const settings = await AppSettingsStore.open(options.settingsFile, options.builtinInstructions);
    return new HostApplication(options, await HostSessionPool.create(options), settings);
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
      settings: this.settings.view(),
      models: this.models(),
      sessions: [...this.sessions.values()].map(({ view }) => view),
      approvals: this.approvals.list(),
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
        return this.create(command.input.model, command.input.instructions, command.input.cwd ?? this.options.cwd);
      case 'open':
        return this.open(command.input.file, command.input.cwd);
      case 'history':
        return (await SessionManager.listAll(this.options.sessionDir)).map(item => ({
          id: item.id,
          file: item.path,
          cwd: item.cwd,
          title: item.name || item.firstMessage || '未命名会话',
          modified: item.modified.toISOString()
        }));
      case 'prompt':
        return this.live(command.input.id).prompt(command.input.text);
      case 'cancel':
        return this.live(command.input.id).stop();
      case 'compact':
        return this.live(command.input.id).compact();
      case 'close':
        return this.close(command.input.id);
      case 'approve':
        return this.approvals.approve(command.input.id, command.input.allow);
      case 'rename':
        return this.live(command.input.id).rename(command.input.name);
      case 'model': {
        const live = this.live(command.input.id);
        const model = this.options.modelRuntime.getModel(command.input.model.provider, command.input.model.id);
        if (!model) throw new Error('所选模型不可用');
        return live.setModel(model);
      }
      case 'instructions':
        return this.live(command.input.id).setInstructions(normalizeInstructions(command.input.entries));
      case 'mode':
        return this.live(command.input.id).setMode(normalizeMode(command.input.mode));
      case 'defaultInstructions':
        await this.settings.setDefaultInstructions(command.input.entries);
        return this.emitSettings();
      case 'namedInstructions':
        await this.settings.saveNamed(command.input);
        return this.emitSettings();
      case 'deleteNamedInstructions':
        await this.settings.deleteNamed(command.input.name);
        return this.emitSettings();
      case 'defaultMode':
        await this.settings.setDefaultMode(command.input.mode);
        return this.emitSettings();
      case 'providers':
        return this.options.modelConfiguration.list();
      case 'saveProvider': {
        const kept = new Set(command.input.config.models?.map(item => item.id));
        this.assertIdle(command.input.id, model => !kept.has(model));
        await this.options.modelConfiguration.save(command.input);
        return this.emit({ kind: 'models', models: this.models() });
      }
      case 'deleteProvider':
        this.assertIdle(command.input.id, () => true);
        await this.options.modelConfiguration.remove(command.input.id);
        return this.emit({ kind: 'models', models: this.models() });
      case 'discoverModels':
        return this.options.modelConfiguration.discover(command.input);
    }
  }

  /** 正在生成内容的模型不能被移除；removed 判断该供应商下的模型是否会被移除。 */
  private assertIdle(provider: string, removed: (model: string) => boolean): void {
    for (const { view } of this.sessions.values())
      if (view.running && view.model?.provider === provider && removed(view.model.id))
        throw new Error('模型正在生成内容，结束后再删除');
  }

  /** 按会话 id 取原生会话，供平台宿主在命令之外直接使用 SDK 能力；不新建也不取消执行者。 */
  liveSession(id: string): LiveSession['session'] | undefined {
    return this.sessions.get(id)?.live?.session;
  }

  private emitSettings(): void {
    this.emit({ kind: 'settings', settings: this.settings.view() });
  }

  private get(id: string): OpenSession {
    const record = this.sessions.get(id);
    if (!record) throw new Error('会话未打开，请重新选择历史会话');
    return record;
  }

  private live(id: string): LiveSession {
    const { live } = this.get(id);
    if (!live) throw new Error('该会话为只读历史，不能继续，请新建会话');
    return live;
  }

  /** 新会话复制一份指令与默认模式，之后与设置各自独立。 */
  private async create(model: ModelRef, name: string | undefined, cwd: string): Promise<string> {
    const applied = { entries: this.settings.instructionsFor(name) };
    const mode = this.settings.defaultMode;
    const { session } = await this.pool.createSession({ ...this.sessionInput(applied, cwd), model });
    session.sessionManager.appendCustomEntry(instructionsEntryType, { entries: applied.entries });
    session.sessionManager.appendCustomEntry(modeEntryType, { mode });
    const live = new LiveSession(session, applied, mode, change => this.emit(change));
    return this.attach({ view: live.view, live });
  }

  private sessionInput(applied: AppliedInstructions, cwd: string) {
    return {
      cwd,
      ...instructionCallbacks(applied),
      toolAccess: { tools: this.options.tools(cwd), authorize: this.approvals.authorize }
    };
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

  /** 完整历史继续对话；损坏或缺少记录的历史只读打开，不修复、不套用当前默认值。 */
  private async openFile(file: string, cwd: string): Promise<string> {
    const applied: AppliedInstructions = { entries: [] };
    const opened: { history?: SessionHistory } = {};
    let result: Awaited<ReturnType<HostSessionPool['openWith']>>;
    try {
      result = await this.pool.openWith({ file, cwd }, manager => {
        const history = sessionHistory(manager);
        opened.history = history;
        if (history.kind === 'readonly') return undefined;
        applied.entries = history.instructions;
        return this.sessionInput(applied, cwd);
      });
    } catch (error) {
      // 需迁移、路径错误或工作目录不匹配的历史仍然报错。
      if (!(error instanceof HostSessionOpenError) || error.code !== 'recovery-required') throw error;
      opened.history = await damagedHistory(file);
    }
    // SAFETY: openWith 成功时 prepare 必已执行，损坏分支也已赋值；可继续的历史必然创建了会话。
    const history = opened.history!;
    if (history.kind === 'readonly') {
      // 只读视图使用新的随机 id，避免与同一会话 id 的可写副本冲突。
      const { readonly, messages, sessionId, name } = history;
      return this.attach({
        view: {
          id: randomUUID(),
          sessionId,
          name,
          file,
          cwd,
          running: false,
          compacting: false,
          instructions: [],
          messages,
          readonly
        }
      });
    }
    const live = new LiveSession(result!.session, applied, history.mode, change => this.emit(change));
    return this.attach({ view: live.view, live });
  }

  private attach(record: OpenSession): string {
    this.sessions.set(record.view.id, record);
    this.emit({ kind: 'session', session: record.view });
    return record.view.id;
  }

  private async close(id: string): Promise<void> {
    const { live } = this.get(id);
    this.sessions.delete(id);
    if (live) {
      await live.stop();
      await this.pool.close(id);
      live.detach();
    }
    this.emit({ kind: 'closed', id });
  }

  async dispose(): Promise<void> {
    this.stopping = true;
    const lives = [...this.sessions.values()].flatMap(({ live }) => (live ? [live] : []));
    await Promise.all(lives.map(live => live.stop()));
    await this.pool.dispose();
    for (const live of lives) live.detach();
    this.sessions.clear();
    this.listeners.clear();
  }
}
