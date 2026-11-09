import { type ModelRuntime, SessionManager, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename, stat } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import type { CreationApplication } from '@chaptale/creation/application';
import type { ImportWorkPackageInput } from '@chaptale/creation/contracts';

import { normalizeInstructions, normalizeMode } from '../instructions/instructions.ts';
import {
  type AgentInstructions,
  type HostChange,
  type HostCommand,
  type HostEvent,
  type HistoryItem,
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
import { targetsCwd } from '../tools/cwd-paths.ts';
import type { HostToolDecision } from '../tools/tool-access.ts';
import { ToolApprovals } from './approvals.ts';
import { damagedHistory, sessionHistory, type SessionHistory } from './history.ts';
import { type AppliedInstructions, instructionCallbacks, LiveSession } from './live-session.ts';
import { createWorkTools, deferredWorkToolsPrompt, workToolNames, workWriteToolNames } from './work-tools/index.ts';

export interface HostApplicationOptions {
  /** 未归属作品的会话使用的空工作目录。 */
  cwd: string;
  agentDir: string;
  /** 会话历史根目录：归属作品的会话在 `<作品 ID>/` 子目录，未归属的在 `unassigned/`。 */
  sessionDir: string;
  /** 应用数据目录下的设置文件绝对路径，不进作品备份。 */
  settingsFile: string;
  /** 作者尚未设置全局默认时，新会话复制的应用内置指令。 */
  builtinInstructions: AgentInstructions;
  modelRuntime: ModelRuntime;
  modelConfiguration: HostModelConfiguration;
  tools: (cwd: string) => ToolDefinition[];
  /** 作品应用与 Agent 共用宿主，直接注入既有应用入口。 */
  creation?: CreationApplication;
}

/** 删除会话前拒绝它留下的全部待审修改，避免候选失去来源。 */
function rejectPendingChanges(creation: CreationApplication, sessionId: string) {
  const listed = creation.executeAuthor({ method: 'listDeliveries', input: { sessionId } });
  if (!listed.ok) throw new Error(listed.error.message);
  for (const summary of listed.value) {
    for (const workId of new Set(summary.items.map(item => item.workId))) {
      const result = creation.executeAuthor({
        method: 'decideDelivery',
        input: {
          commandId: randomUUID(),
          groupId: summary.group.id,
          workId,
          decision: 'reject',
          targets: summary.items.filter(item => item.workId === workId).map(item => item.target)
        }
      });
      if (!result.ok) throw new Error(result.error.message);
    }
  }
}

/** 会话归属的作品；未归属或作品已在回收站时为 null。 */
type SessionWork = { id: string; title: string } | null;

/** 未归属会话所在的子目录；作品 ID 不会与它重名。 */
const unassignedFolder = 'unassigned';

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
      tools: this.tools(this.options.cwd).map(tool => tool.name)
    });
  }

  async execute(command: HostCommand): Promise<unknown> {
    if (this.stopping) throw new Error('Agent 宿主已停止');
    switch (command.method) {
      case 'state':
        return this.snapshot();
      case 'create':
        return this.create(command.input.model, command.input.instructions, command.input.workId);
      case 'open':
        return this.open(command.input.file);
      case 'history':
        return this.history();
      case 'assignSession':
        return this.assignSession(command.input.sessionId, command.input.workId);
      case 'prompt':
        return this.live(command.input.id).prompt(command.input.text);
      case 'cancel':
        return this.live(command.input.id).stop();
      case 'compact':
        return this.live(command.input.id).compact();
      case 'close':
        return this.close(command.input.id);
      case 'deleteSessions':
        return this.deleteSessions(command.input.sessionIds);
      case 'trashWork':
        return this.trashWork(command.input);
      case 'purgeWork':
        return this.purgeWork(command.input);
      case 'importWorkPackage':
        return this.importWorkPackage(command.input);
      case 'restoreWorkSnapshot':
        return this.restoreWorkSnapshot(command.input);
      case 'approve':
        return this.approvals.approve(command.input.id, command.input.allow);
      case 'rename':
        return this.live(command.input.id).rename(command.input.name);
      case 'model': {
        const live = this.live(command.input.id);
        const model = this.options.modelRuntime.getModel(command.input.model.provider, command.input.model.id);
        if (!model) throw new Error('所选模型不可用');
        // 先记下作者的选择，设置写入失败时不切换。
        await this.rememberModel(command.input.model);
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

  private async rememberModel(model: ModelRef): Promise<void> {
    if (await this.settings.setLastModel(model)) this.emitSettings();
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

  /** 作品文件目录；未归属的会话使用应用的空工作目录。 */
  private async workingDirectory(work: SessionWork): Promise<string> {
    if (!work) return this.options.cwd;
    const prepared = await this.options.creation!.execute({ method: 'prepareWorkFiles', input: { workId: work.id } });
    if (!prepared.ok) throw new Error(prepared.error.message);
    return prepared.value;
  }

  private findWork(workId: string | null): SessionWork {
    if (workId === null) return null;
    const works = this.options.creation!.executeAuthor({ method: 'listWorks', input: {} });
    if (!works.ok) throw new Error(works.error.message);
    const work = works.value.find(item => item.id === workId);
    return work ? { id: work.id, title: work.title } : null;
  }

  /** 历史文件所在子目录对应的作品 ID；未归属为 null。 */
  private workIdOf(file: string): string | null {
    const folder = relative(this.options.sessionDir, dirname(file));
    return folder === unassignedFolder ? null : folder;
  }

  /** 按子目录汇总全部历史；排列顺序由界面决定。 */
  private async history(): Promise<HistoryItem[]> {
    const folders = (await readdir(this.options.sessionDir, { withFileTypes: true })).filter(item =>
      item.isDirectory()
    );
    const lists = await Promise.all(
      folders.map(async folder =>
        (await SessionManager.listAll(join(this.options.sessionDir, folder.name))).map(item => ({
          id: item.id,
          file: item.path,
          workId: folder.name === unassignedFolder ? null : folder.name,
          title: item.name || item.firstMessage || '未命名会话',
          modified: item.modified.toISOString()
        }))
      )
    );
    return lists.flat();
  }

  /** 新会话复制一份指令与默认模式，之后与设置各自独立；指定作品时先归入作品再交给界面。 */
  private async create(model: ModelRef, name: string | undefined, workId: string | null): Promise<string> {
    const work = this.findWork(workId);
    if (workId !== null && !work) throw new Error('目标作品不存在');
    const cwd = await this.workingDirectory(work);
    const applied = { entries: this.settings.instructionsFor(name) };
    const mode = this.settings.defaultMode;
    // 先记下作者的选择，设置写入失败时不创建会话。
    await this.rememberModel(model);
    const { session } = await this.pool.createSession(
      { ...this.sessionInput(applied, cwd, work), model },
      work?.id ?? unassignedFolder
    );
    session.sessionManager.appendCustomEntry(instructionsEntryType, { entries: applied.entries });
    session.sessionManager.appendCustomEntry(modeEntryType, { mode });
    const live = new LiveSession(session, applied, mode, change => this.emit(change), {
      workId: work?.id ?? null,
      creation: this.options.creation
    });
    return this.attach({ view: live.view, live });
  }

  private tools(cwd: string): ToolDefinition[] {
    const tools = [...this.options.tools(cwd)];
    if (this.options.creation)
      tools.push(
        ...createWorkTools(
          this.options.creation,
          id => this.live(id).view.mode!,
          id => this.live(id).reviewWritten()
        )
      );
    return tools;
  }

  /** 作品工具无需逐次确认；讨论模式下写工具即使经 tool_search 加载或嵌套调用也不执行。 */
  private authorizeWorkTool(request: { sessionId: string; toolName: string }): HostToolDecision {
    if (workWriteToolNames.has(request.toolName) && this.live(request.sessionId).view.mode === 'discuss')
      return { allow: false, reason: '当前为讨论模式，作品只读' };
    return { allow: true };
  }

  private sessionInput(applied: AppliedInstructions, cwd: string, work: SessionWork) {
    const callbacks = instructionCallbacks(applied);
    const identity = work ? `\n\n本会话归属作品《${work.title}》，作品 ID 为 ${work.id}。` : '';
    return {
      cwd,
      ...callbacks,
      ...(this.options.creation && {
        systemPrompt: () => `${callbacks.systemPrompt()}\n\n${deferredWorkToolsPrompt}${identity}`
      }),
      toolAccess: {
        tools: this.tools(cwd),
        // 原生文件工具在工作目录内不逐次询问，目录外仍由作者授权。
        authorize: async (request: Parameters<ToolApprovals['authorize']>[0], signal: AbortSignal | undefined) => {
          if (this.options.creation && workToolNames.has(request.toolName)) return this.authorizeWorkTool(request);
          if (await targetsCwd(request.toolName, request.input, request.cwd)) return { allow: true } as const;
          return this.approvals.authorize(request, signal);
        },
        onToolsLoaded: (sessionId: string) => this.live(sessionId).syncWorkTools()
      }
    };
  }

  private open(file: string): Promise<string> {
    const existing = [...this.sessions.values()].find(record => record.view.file === file);
    if (existing) return Promise.resolve(existing.view.id);
    const pending = this.opening.get(file);
    if (pending) return pending;
    const operation = this.openFile(file);
    this.opening.set(file, operation);
    const finished = () => {
      this.opening.delete(file);
    };
    void operation.then(finished, finished);
    return operation;
  }

  /** 完整历史继续对话；损坏或缺少记录的历史只读打开，不修复、不套用当前默认值。 */
  private async openFile(file: string): Promise<string> {
    const applied: AppliedInstructions = { entries: [] };
    const opened: { history?: SessionHistory; work?: SessionWork; cwd?: string } = {};
    const workId = this.workIdOf(file);
    const cwd = async () => {
      opened.work = this.findWork(workId);
      opened.cwd = await this.workingDirectory(opened.work);
      return opened.cwd;
    };
    let result: Awaited<ReturnType<HostSessionPool['openWith']>>;
    try {
      result = await this.pool.openWith({ file, cwd }, manager => {
        const history = sessionHistory(manager, this.options.creation);
        opened.history = history;
        if (history.kind === 'readonly') return undefined;
        applied.entries = history.instructions;
        // SAFETY: 预检通过后才交给 prepare，工作目录与归属已经确定。
        return this.sessionInput(applied, opened.cwd!, opened.work!);
      });
    } catch (error) {
      // 需迁移或路径错误的历史仍然报错。
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
          workId,
          running: false,
          compacting: false,
          instructions: [],
          messages,
          readonly
        }
      });
    }
    const live = new LiveSession(result!.session, applied, history.mode, change => this.emit(change), {
      workId,
      creation: this.options.creation,
      directAfterGroupId: history.directAfterGroupId
    });
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

  private async deleteSessions(sessionIds: string[]): Promise<{ files: string[] }> {
    const ids = new Set(sessionIds);
    const open = [...this.sessions].filter(([, { view }]) => view.sessionId !== null && ids.has(view.sessionId));
    if (open.some(([, { view }]) => view.running || view.compacting)) throw new Error('有会话正在运行，停止后才能删除');
    const files = (await this.history()).filter(item => ids.has(item.id)).map(item => item.file);
    const { creation } = this.options;
    if (creation) {
      for (const id of ids) rejectPendingChanges(creation, id);
      const forgotten = creation.executeAuthor({ method: 'forgetSessions', input: { sessionIds: [...ids] } });
      if (!forgotten.ok) throw new Error(forgotten.error.message);
    }
    for (const [id] of open) await this.close(id);
    return { files };
  }

  /** 未归属会话的历史文件移入作品目录；已打开的先关闭，移动后重新打开。 */
  private async assignSession(sessionId: string, workId: string): Promise<string | null> {
    if (!this.findWork(workId)) throw new Error('目标作品不存在');
    const item = (await this.history()).find(candidate => candidate.id === sessionId);
    if (!item) throw new Error('会话还没有内容，发送消息后再归入作品');
    if (item.workId !== null) throw new Error('会话已归属作品');
    const open = [...this.sessions].filter(([, { view }]) => view.sessionId === sessionId);
    if (open.some(([, { view }]) => view.running || view.compacting))
      throw new Error('会话正在运行，停止后才能归入作品');
    for (const [id] of open) await this.close(id);
    const target = join(this.options.sessionDir, workId, basename(item.file));
    await mkdir(dirname(target), { recursive: true });
    await rename(item.file, target);
    const forgotten = this.options.creation!.executeAuthor({
      method: 'forgetSessions',
      input: { sessionIds: [sessionId] }
    });
    if (!forgotten.ok) throw new Error(forgotten.error.message);
    return open.length > 0 ? this.open(target) : null;
  }

  /** 属于作品的已打开会话；任一在运行时用 action 说明被拒绝的操作。 */
  private idleWorkSessions(workId: string, action: string): string[] {
    const open = [...this.sessions].filter(([, { view }]) => view.workId === workId);
    if (open.some(([, { view }]) => view.running || view.compacting))
      throw new Error(`有会话正在运行，停止后才能${action}`);
    return open.map(([id]) => id);
  }

  private async importWorkPackage(input: ImportWorkPackageInput) {
    const creation = this.options.creation!;
    let open: string[] = [];
    if (!input.asCopy) {
      const info = await creation.execute({ method: 'inspectWorkPackage', input: { path: input.path } });
      if (!info.ok) throw new Error(info.error.message);
      if (info.value.exists) open = this.idleWorkSessions(info.value.work.id, '覆盖作品');
    }
    const imported = await creation.execute({ method: 'importWorkPackage', input });
    if (!imported.ok) throw new Error(imported.error.message);
    for (const id of open) await this.close(id);
    return imported.value;
  }

  private async restoreWorkSnapshot(input: { commandId: string; workId: string }) {
    const open = this.idleWorkSessions(input.workId, '恢复作品');
    const restored = await this.options.creation!.execute({ method: 'restoreWorkSnapshot', input });
    if (!restored.ok) throw new Error(restored.error.message);
    for (const id of open) await this.close(id);
    return restored.value;
  }

  private async trashWork(input: { commandId: string; workId: string }) {
    const creation = this.options.creation!;
    const open = this.idleWorkSessions(input.workId, '删除作品');
    const trashed = creation.executeAuthor({ method: 'trashWork', input });
    if (!trashed.ok) throw new Error(trashed.error.message);
    for (const id of open) await this.close(id);
    return trashed.value;
  }

  /** 永久删除作品；其会话目录随作品目录交给平台移入回收站。 */
  private async purgeWork(input: { commandId: string; workId: string }): Promise<{ files: string[] }> {
    const open = this.idleWorkSessions(input.workId, '永久删除作品');
    const purged = this.options.creation!.executeAuthor({ method: 'purgeWork', input });
    if (!purged.ok) throw new Error(purged.error.message);
    for (const id of open) await this.close(id);
    const sessions = join(this.options.sessionDir, input.workId);
    const exists = await stat(sessions).then(
      () => true,
      () => false
    );
    return { files: exists ? [...purged.value.files, sessions] : purged.value.files };
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
