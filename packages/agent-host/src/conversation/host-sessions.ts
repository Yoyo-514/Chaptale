import { SessionManager, type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { mkdir, readdir, rename } from 'node:fs/promises';
import { basename, dirname, join, relative } from 'node:path';

import type { CreationApplication } from '@chaptale/creation/application';

import type { HostMcpService, SessionMcpBridge } from '../mcp/index.ts';
import type { ToolAuthorizer } from '../permissions/tool-authorizer.ts';
import {
  type HistoryItem,
  type HostChange,
  instructionsEntryType,
  type ModelRef,
  modeEntryType,
  type SessionView
} from '../protocol/index.ts';
import type { HostSessionPool } from '../session/session-pool.ts';
import { HostSessionOpenError } from '../session/session-storage.ts';
import type { AppSettingsStore } from '../settings/app-settings.ts';
import type { HostSkillsService, SessionSkillsState } from '../skills/index.ts';
import type { HostToolDecision, HostToolRequest } from '../tools/tool-access.ts';
import { rejectPendingChanges } from '../work/review-results.ts';
import type { SessionWork, SessionWorks } from '../work/session-work.ts';
import { createWorkTools, deferredWorkToolsPrompt, workToolNames, workWriteToolNames } from '../work/tools/index.ts';
import { damagedHistory, sessionHistory, type SessionHistory } from './history.ts';
import { type AppliedInstructions, instructionCallbacks, LiveSession } from './live-session.ts';

/** 未归属会话所在的子目录；作品 ID 不会与它重名。 */
const unassignedFolder = 'unassigned';

/** 已打开的会话；只读历史只有视图，没有可继续的会话。 */
interface OpenSession {
  view: SessionView;
  live?: LiveSession;
  mcp?: SessionMcpBridge;
}

export interface HostSessionsOptions {
  /** 会话历史根目录：归属作品的会话在 `<作品 ID>/` 子目录，未归属的在 `unassigned/`。 */
  sessionDir: string;
  /** 未归属会话的空工作目录，只用来列出工具名。 */
  cwd: string;
  tools: (cwd: string) => ToolDefinition[];
  creation?: CreationApplication;
  pool: HostSessionPool;
  settings: AppSettingsStore;
  skills: HostSkillsService;
  mcp: HostMcpService;
  works: SessionWorks;
  authorizer: ToolAuthorizer;
  emit: (change: HostChange) => void;
  /** 作者选了模型；设置写入失败时抛错，会话不创建。 */
  rememberModel: (model: ModelRef) => Promise<void>;
  /** 本机设置变了，通知界面。 */
  onSettingsChanged: () => void;
}

/**
 * 已打开的会话：新建、按历史文件打开、关闭、归入作品与删除。
 * 原生会话由会话池持有，这里把它们接上指令、作品工具、技能、MCP 与授权。
 */
export class HostSessions {
  private readonly open = new Map<string, OpenSession>();
  private readonly opening = new Map<string, Promise<string>>();
  private readonly options: HostSessionsOptions;

  constructor(options: HostSessionsOptions) {
    this.options = options;
  }

  views(): SessionView[] {
    return [...this.open.values()].map(({ view }) => view);
  }

  view(id: string): SessionView {
    return this.get(id).view;
  }

  /** 可继续的会话；未打开或只读历史时为 undefined。 */
  find(id: string): LiveSession | undefined {
    return this.open.get(id)?.live;
  }

  live(id: string): LiveSession {
    const { live } = this.get(id);
    if (!live) throw new Error('该会话为只读历史，不能继续，请新建会话');
    return live;
  }

  /** 应用注册给会话的工具名；作品工具随作品应用装配。 */
  toolNames(): string[] {
    return this.tools(this.options.cwd).map(tool => tool.name);
  }

  /** 新会话复制一份指令与默认模式，之后与设置各自独立；指定作品时先归入作品再交给界面。 */
  async create(model: ModelRef, name: string | undefined, workId: string | null): Promise<string> {
    const { settings, skills, works } = this.options;
    const work = works.find(workId);
    if (workId !== null && !work) throw new Error('目标作品不存在');
    const cwd = await works.directory(work);
    const applied = { entries: settings.instructionsFor(name) };
    const mode = settings.defaultMode;
    const skillsState = await skills.createSessionState(work?.id ?? null);
    // 先记下作者的选择，设置写入失败时不创建会话。
    await this.options.rememberModel(model);
    const mcp = await this.options.mcp.createSessionBridge(work?.id ?? null);
    const { session } = await this.options.pool
      .createSession(
        { ...this.sessionInput(applied, cwd, work, skillsState, mcp), model },
        work?.id ?? unassignedFolder
      )
      .catch((error: unknown) => {
        mcp.dispose();
        throw error;
      });
    session.sessionManager.appendCustomEntry(instructionsEntryType, { entries: applied.entries });
    session.sessionManager.appendCustomEntry(modeEntryType, { mode });
    const live = new LiveSession(session, applied, mode, this.options.emit, {
      workId: work?.id ?? null,
      creation: this.options.creation,
      skills: skillsState,
      mcp
    });
    return this.attach({ view: live.view, live, mcp });
  }

  /** 同一历史文件只打开一次；正在打开时共用同一次操作。 */
  openFile(file: string): Promise<string> {
    const existing = [...this.open.values()].find(record => record.view.file === file);
    if (existing) return Promise.resolve(existing.view.id);
    const pending = this.opening.get(file);
    if (pending) return pending;
    const operation = this.restore(file);
    this.opening.set(file, operation);
    const finished = () => {
      this.opening.delete(file);
    };
    void operation.then(finished, finished);
    return operation;
  }

  async close(id: string): Promise<void> {
    const { live, mcp } = this.get(id);
    this.open.delete(id);
    mcp?.dispose();
    if (live) {
      await live.stop();
      await this.options.pool.close(id);
      live.detach();
    }
    this.options.emit({ kind: 'closed', id });
  }

  /** 按子目录汇总全部历史；排列顺序由界面决定。 */
  async history(): Promise<HistoryItem[]> {
    const { sessionDir } = this.options;
    const folders = (await readdir(sessionDir, { withFileTypes: true })).filter(item => item.isDirectory());
    const lists = await Promise.all(
      folders.map(async folder =>
        (await SessionManager.listAll(join(sessionDir, folder.name))).map(item => ({
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

  /** 未归属会话的历史文件移入作品目录；已打开的先关闭，移动后重新打开。 */
  async assign(sessionId: string, workId: string): Promise<string | null> {
    if (!this.options.works.find(workId)) throw new Error('目标作品不存在');
    const item = (await this.history()).find(candidate => candidate.id === sessionId);
    if (!item) throw new Error('会话还没有内容，发送消息后再归入作品');
    if (item.workId !== null) throw new Error('会话已归属作品');
    const open = [...this.open].filter(([, { view }]) => view.sessionId === sessionId);
    if (open.some(([, { view }]) => view.running || view.compacting))
      throw new Error('会话正在运行，停止后才能归入作品');
    for (const [id] of open) await this.close(id);
    const target = join(this.options.sessionDir, workId, basename(item.file));
    await mkdir(dirname(target), { recursive: true });
    await rename(item.file, target);
    // SAFETY: 能找到作品说明作品应用已装配。
    const forgotten = this.options.creation!.executeAuthor({
      method: 'forgetSessions',
      input: { sessionIds: [sessionId] }
    });
    if (!forgotten.ok) throw new Error(forgotten.error.message);
    return open.length > 0 ? this.openFile(target) : null;
  }

  /** 删除会话前的收尾：拒绝它们的待审修改、清除查看位置与会话级授权、关闭已打开的；返回待删除的历史文件。 */
  async delete(sessionIds: string[]): Promise<{ files: string[] }> {
    const ids = new Set(sessionIds);
    const open = [...this.open].filter(([, { view }]) => view.sessionId !== null && ids.has(view.sessionId));
    if (open.some(([, { view }]) => view.running || view.compacting)) throw new Error('有会话正在运行，停止后才能删除');
    const files = (await this.history()).filter(item => ids.has(item.id)).map(item => item.file);
    const { creation } = this.options;
    if (creation) {
      for (const id of ids) rejectPendingChanges(creation, id);
      const forgotten = creation.executeAuthor({ method: 'forgetSessions', input: { sessionIds: [...ids] } });
      if (!forgotten.ok) throw new Error(forgotten.error.message);
    }
    for (const [id] of open) await this.close(id);
    if (await this.options.settings.clearSessionPermissions(ids)) this.options.onSettingsChanged();
    return { files };
  }

  /** 属于作品的已打开会话；任一在运行时用 action 说明被拒绝的操作。 */
  idleOfWork(workId: string, action: string): string[] {
    const open = [...this.open].filter(([, { view }]) => view.workId === workId);
    if (open.some(([, { view }]) => view.running || view.compacting))
      throw new Error(`有会话正在运行，停止后才能${action}`);
    return open.map(([id]) => id);
  }

  /** 宿主停止：结束全部运行并释放原生会话。视图在 release 之前仍可读取。 */
  async stop(): Promise<void> {
    await Promise.all(this.lives().map(live => live.stop()));
    await this.options.pool.dispose();
  }

  release(): void {
    for (const live of this.lives()) live.detach();
    this.open.clear();
  }

  private lives(): LiveSession[] {
    return [...this.open.values()].flatMap(({ live }) => (live ? [live] : []));
  }

  private get(id: string): OpenSession {
    const record = this.open.get(id);
    if (!record) throw new Error('会话未打开，请重新选择历史会话');
    return record;
  }

  private attach(record: OpenSession): string {
    this.open.set(record.view.id, record);
    this.options.emit({ kind: 'session', session: record.view });
    return record.view.id;
  }

  /** 历史文件所在子目录对应的作品 ID；未归属为 null。 */
  private workIdOf(file: string): string | null {
    const folder = relative(this.options.sessionDir, dirname(file));
    return folder === unassignedFolder ? null : folder;
  }

  /** 完整历史继续对话；损坏或缺少记录的历史只读打开，不修复、不套用当前默认值。 */
  private async restore(file: string): Promise<string> {
    const { works } = this.options;
    const applied: AppliedInstructions = { entries: [] };
    const opened: {
      history?: SessionHistory;
      work?: SessionWork;
      cwd?: string;
      skills?: SessionSkillsState;
      mcp?: SessionMcpBridge;
    } = {};
    const workId = this.workIdOf(file);
    const cwd = async () => {
      opened.work = works.find(workId);
      opened.cwd = await works.directory(opened.work);
      opened.skills = await this.options.skills.createSessionState(opened.work?.id ?? null);
      opened.mcp = await this.options.mcp.createSessionBridge(opened.work?.id ?? null);
      return opened.cwd;
    };
    let result: Awaited<ReturnType<HostSessionPool['openWith']>>;
    try {
      result = await this.options.pool.openWith({ file, cwd }, manager => {
        const history = sessionHistory(manager);
        opened.history = history;
        if (history.kind === 'readonly') return undefined;
        applied.entries = history.instructions;
        // SAFETY: 预检通过后才交给 prepare，工作目录、归属、技能快照与 MCP 接入已经确定。
        return this.sessionInput(applied, opened.cwd!, opened.work!, opened.skills!, opened.mcp!);
      });
    } catch (error) {
      opened.mcp?.dispose();
      // 需迁移或路径错误的历史仍然报错。
      if (!(error instanceof HostSessionOpenError) || error.code !== 'recovery-required') throw error;
      opened.history = await damagedHistory(file);
    }
    // SAFETY: openWith 成功时 prepare 必已执行，损坏分支也已赋值；可继续的历史必然创建了会话。
    const history = opened.history!;
    if (history.kind === 'readonly') {
      opened.mcp?.dispose();
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
    const live = new LiveSession(result!.session, applied, history.mode, this.options.emit, {
      workId,
      creation: this.options.creation,
      skills: opened.skills,
      mcp: opened.mcp
    });
    return this.attach({ view: live.view, live, mcp: opened.mcp });
  }

  private tools(cwd: string): ToolDefinition[] {
    const tools = [...this.options.tools(cwd)];
    if (this.options.creation) tools.push(...createWorkTools(this.options.creation, id => this.live(id).view.mode!));
    return tools;
  }

  /** 作品工具无需逐次确认；讨论模式下写工具即使经 tool_search 加载或嵌套调用也不执行。 */
  private authorizeWorkTool(request: { sessionId: string; toolName: string }): HostToolDecision {
    if (workWriteToolNames.has(request.toolName) && this.live(request.sessionId).view.mode === 'discuss')
      return { allow: false, reason: '当前为讨论模式，作品只读' };
    return { allow: true };
  }

  /** 交给会话池的装配：指令回调、系统提示词、技能，以及带授权的工具。 */
  private sessionInput(
    applied: AppliedInstructions,
    cwd: string,
    work: SessionWork,
    skillsState: SessionSkillsState,
    mcp: SessionMcpBridge
  ) {
    const { creation, works, authorizer } = this.options;
    const callbacks = instructionCallbacks(applied);
    return {
      cwd,
      ...callbacks,
      ...(creation && {
        systemPrompt: () => `${callbacks.systemPrompt()}\n\n${deferredWorkToolsPrompt}${works.prompt(work)}`
      }),
      skills: () => skillsState.currentSkills(),
      toolAccess: {
        tools: this.tools(cwd),
        mcpExtensions: mcp.extensions,
        authorize: async (request: HostToolRequest, signal: AbortSignal | undefined) => {
          if (creation && workToolNames.has(request.toolName)) return this.authorizeWorkTool(request);
          // 作品进了回收站后，会话不再按作品规则放行，也不能保存作品级规则。
          const workId = work && works.find(work.id) ? work.id : null;
          return authorizer.authorize(
            request,
            { workId, mcp, allowsSkillTarget: target => skillsState.allowsTarget(target) },
            signal
          );
        },
        onToolsLoaded: (sessionId: string) => this.live(sessionId).syncWorkTools(),
        onToolActivity: (sessionId: string, event: Parameters<LiveSession['toolActivity']>[0]) =>
          this.find(sessionId)?.toolActivity(event)
      }
    };
  }
}
