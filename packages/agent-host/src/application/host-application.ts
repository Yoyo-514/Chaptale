import type { ModelRuntime, ToolDefinition } from '@earendil-works/pi-coding-agent';
import { stat } from 'node:fs/promises';
import { join } from 'node:path';

import type { CreationApplication } from '@chaptale/creation/application';
import type { ImportWorkPackageInput } from '@chaptale/creation/contracts';

import { HostSessions } from '../conversation/host-sessions.ts';
import type { LiveSession } from '../conversation/live-session.ts';
import { normalizeInstructions, normalizeMode } from '../instructions/instructions.ts';
import { HostMcpService } from '../mcp/index.ts';
import { ToolAuthorizer } from '../permissions/tool-authorizer.ts';
import type {
  AgentInstructions,
  HostChange,
  HostCommand,
  HostEvent,
  HostState,
  ModelChoice,
  ModelRef
} from '../protocol/index.ts';
import type { EmbeddingConfiguration } from '../retrieval/config.ts';
import { HostRetrievalService } from '../retrieval/service.ts';
import type { HostModelConfiguration } from '../runtime/model-configuration.ts';
import { HostSessionPool } from '../session/session-pool.ts';
import { AppSettingsStore } from '../settings/app-settings.ts';
import { HostSkillsService } from '../skills/index.ts';
import { SessionWorks } from '../work/session-work.ts';

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
  embeddingConfiguration: EmbeddingConfiguration;
  tools: (cwd: string) => ToolDefinition[];
  /** 作品应用与 Agent 共用宿主，直接注入既有应用入口。 */
  creation?: CreationApplication;
}

/**
 * 正式宿主的有限命令入口：装配各领域服务、分发命令、向界面广播变化。
 * 会话/工具执行仍由原生 SDK 持有；重连读取快照，不重发 prompt。
 */
export class HostApplication {
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private cursor = 0;
  private stopping = false;

  private readonly options: HostApplicationOptions;
  private readonly settings: AppSettingsStore;
  private readonly works: SessionWorks;
  private readonly skills: HostSkillsService;
  private readonly mcp: HostMcpService;
  private readonly authorizer: ToolAuthorizer;
  private readonly retrieval: HostRetrievalService;
  private readonly sessions: HostSessions;

  private constructor(options: HostApplicationOptions, pool: HostSessionPool, settings: AppSettingsStore) {
    this.options = options;
    this.settings = settings;
    this.works = new SessionWorks(options.creation, options.cwd);
    this.skills = new HostSkillsService({
      agentDir: options.agentDir,
      settings,
      resolveWorkFilesDir: async workId => {
        const work = this.works.find(workId);
        if (!work) throw new Error('目标作品不存在');
        return this.works.directory(work);
      }
    });
    this.mcp = new HostMcpService({
      agentDir: options.agentDir,
      defaultGlobalCwd: options.cwd,
      resolveWorkFilesDir: async workId => {
        const work = this.works.find(workId);
        return work ? this.works.directory(work) : null;
      },
      onChange: () => {
        if (!this.stopping) this.emit({ kind: 'mcp' });
      }
    });
    this.authorizer = new ToolAuthorizer({
      rules: settings,
      emit: change => this.emit(change),
      onRulesChanged: () => this.emitSettings(),
      workExists: workId => this.works.find(workId) !== null
    });
    this.retrieval = new HostRetrievalService({
      configuration: options.embeddingConfiguration,
      creation: options.creation,
      emit: change => {
        if (!this.stopping) this.emit(change);
      }
    });
    this.sessions = new HostSessions({
      sessionDir: options.sessionDir,
      cwd: options.cwd,
      tools: options.tools,
      creation: options.creation,
      pool,
      settings,
      skills: this.skills,
      mcp: this.mcp,
      works: this.works,
      authorizer: this.authorizer,
      emit: change => this.emit(change),
      rememberModel: model => this.rememberModel(model),
      onSettingsChanged: () => this.emitSettings()
    });
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
      sessions: this.sessions.views(),
      approvals: this.authorizer.pending(),
      tools: this.sessions.toolNames()
    });
  }

  async execute(command: HostCommand): Promise<unknown> {
    if (this.stopping) throw new Error('Agent 宿主已停止');
    switch (command.method) {
      case 'state':
        return this.snapshot();
      case 'create':
        return this.sessions.create(command.input.model, command.input.instructions, command.input.workId);
      case 'open':
        return this.sessions.openFile(command.input.file);
      case 'history':
        return this.sessions.history();
      case 'assignSession':
        return this.sessions.assign(command.input.sessionId, command.input.workId);
      case 'prompt':
        return this.sessions
          .live(command.input.id)
          .prompt(
            command.input.text,
            command.input.editorContext && structuredClone(command.input.editorContext),
            command.input.delivery
          );
      case 'dequeue':
        return this.sessions.live(command.input.id).dequeue(command.input.delivery, command.input.index);
      case 'editMessage':
        return this.sessions
          .live(command.input.id)
          .editMessage(
            command.input.entryId,
            command.input.text,
            command.input.editorContext && structuredClone(command.input.editorContext),
            command.input.discardPending
          );
      case 'switchBranch':
        return this.sessions.live(command.input.id).switchBranch(command.input.leafId, command.input.discardPending);
      case 'cancel':
        return this.sessions.live(command.input.id).stop();
      case 'compact':
        return this.sessions.live(command.input.id).compact();
      case 'dismissError':
        this.sessions.find(command.input.id)?.clearError();
        return;
      case 'close':
        return this.sessions.close(command.input.id);
      case 'deleteSessions':
        return this.sessions.delete(command.input.sessionIds);
      case 'trashWork':
        return this.trashWork(command.input);
      case 'purgeWork':
        return this.purgeWork(command.input);
      case 'importWorkPackage':
        return this.importWorkPackage(command.input);
      case 'restoreWorkSnapshot':
        return this.restoreWorkSnapshot(command.input);
      case 'approve':
        return this.authorizer.approve(command.input);
      case 'revokeToolPermission':
        await this.settings.revokeToolPermission(command.input.id);
        return this.emitSettings();
      case 'rename':
        return this.sessions.live(command.input.id).rename(command.input.name);
      case 'model': {
        const live = this.sessions.live(command.input.id);
        const model = this.options.modelRuntime.getModel(command.input.model.provider, command.input.model.id);
        if (!model) throw new Error('所选模型不可用');
        // 先记下作者的选择，设置写入失败时不切换。
        await this.rememberModel(command.input.model);
        return live.setModel(model);
      }
      case 'instructions':
        return this.sessions.live(command.input.id).setInstructions(normalizeInstructions(command.input.entries));
      case 'mode':
        return this.sessions.live(command.input.id).setMode(normalizeMode(command.input.mode));
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
      case 'listSkills':
        return this.skills.list(command.input.workId);
      case 'setSkillEnabled':
        return this.skills.setEnabled(command.input);
      case 'createSkill':
        return this.skills.create(command.input);
      case 'importSkill':
        return this.skills.import(command.input);
      case 'removeSkill':
        return this.skills.remove(command.input);
      case 'sessionSkills':
        return this.skills.sessionItems(this.works.find(this.sessions.view(command.input.id).workId)?.id ?? null);
      case 'getMcpState':
        return this.mcp.getSnapshot(command.input.workId);
      case 'saveMcpConfig':
        return this.mcp.saveConfig(command.input);
      case 'patchMcpServer':
        return this.mcp.patchServer(command.input);
      case 'reconnectMcpServer':
        return this.mcp.reconnectServer(command.input);
      case 'startMcpSignIn':
        return this.mcp.startSignIn(command.input);
      case 'submitMcpRedirectUrl':
        return this.mcp.submitRedirectUrl(command.input);
      case 'cancelMcpSignIn':
        return this.mcp.cancelSignIn(command.input);
      case 'signOutMcpServer':
        return this.mcp.signOut(command.input);
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
      case 'embeddingSettings':
        return this.retrieval.settings();
      case 'saveEmbeddingSettings':
        return this.retrieval.saveSettings(command.input);
      case 'testEmbedding':
        return this.retrieval.test(command.input);
      case 'vectorIndex':
        return this.retrieval.status(command.input.workId);
      case 'buildVectorIndex':
        return this.retrieval.build(command.input.workId, command.input.rebuild);
      case 'cancelVectorIndex':
        return this.retrieval.cancel(command.input.workId);
    }
  }

  /** 正在生成内容的模型不能被移除；removed 判断该供应商下的模型是否会被移除。 */
  private assertIdle(provider: string, removed: (model: string) => boolean): void {
    for (const view of this.sessions.views())
      if (view.running && view.model?.provider === provider && removed(view.model.id))
        throw new Error('模型正在生成内容，结束后再删除');
  }

  /** 按会话 id 取原生会话，供平台宿主在命令之外直接使用 SDK 能力；不新建也不取消执行者。 */
  liveSession(id: string): LiveSession['session'] | undefined {
    return this.sessions.find(id)?.session;
  }

  private async rememberModel(model: ModelRef): Promise<void> {
    if (await this.settings.setLastModel(model)) this.emitSettings();
  }

  private emitSettings(): void {
    this.emit({ kind: 'settings', settings: this.settings.view() });
  }

  private async importWorkPackage(input: ImportWorkPackageInput) {
    const creation = this.options.creation!;
    let open: string[] = [];
    if (!input.asCopy) {
      const info = await creation.execute({ method: 'inspectWorkPackage', input: { path: input.path } });
      if (!info.ok) throw new Error(info.error.message);
      if (info.value.exists) {
        open = this.sessions.idleOfWork(info.value.work.id, '覆盖作品');
        await this.retrieval.stop(info.value.work.id);
      }
    }
    const imported = await creation.execute({ method: 'importWorkPackage', input });
    if (!imported.ok) throw new Error(imported.error.message);
    for (const id of open) await this.sessions.close(id);
    if (!input.asCopy) await this.mcp.closeWork(imported.value.work.id);
    return imported.value;
  }

  private async restoreWorkSnapshot(input: { commandId: string; workId: string }) {
    const open = this.sessions.idleOfWork(input.workId, '恢复作品');
    await this.retrieval.stop(input.workId);
    const restored = await this.options.creation!.execute({ method: 'restoreWorkSnapshot', input });
    if (!restored.ok) throw new Error(restored.error.message);
    for (const id of open) await this.sessions.close(id);
    return restored.value;
  }

  private async trashWork(input: { commandId: string; workId: string }) {
    const creation = this.options.creation!;
    const open = this.sessions.idleOfWork(input.workId, '删除作品');
    await this.retrieval.stop(input.workId);
    const trashed = creation.executeAuthor({ method: 'trashWork', input });
    if (!trashed.ok) throw new Error(trashed.error.message);
    for (const id of open) await this.sessions.close(id);
    await this.mcp.closeWork(input.workId);
    return trashed.value;
  }

  /** 永久删除作品；其会话目录随作品目录交给平台移入回收站。 */
  private async purgeWork(input: { commandId: string; workId: string }): Promise<{ files: string[] }> {
    const open = this.sessions.idleOfWork(input.workId, '永久删除作品');
    await this.retrieval.stop(input.workId);
    const purged = this.options.creation!.executeAuthor({ method: 'purgeWork', input });
    if (!purged.ok) throw new Error(purged.error.message);
    for (const id of open) await this.sessions.close(id);
    // 作品目录随后交给平台删除，先结束以它为工作目录的服务进程。
    await this.mcp.closeWork(input.workId, { purgeCredentials: true });
    const workSessionIds = (await this.sessions.history())
      .filter(item => item.workId === input.workId)
      .map(item => item.id);
    if (await this.settings.clearWorkPermissions(input.workId, workSessionIds)) this.emitSettings();
    const sessions = join(this.options.sessionDir, input.workId);
    const exists = await stat(sessions).then(
      () => true,
      () => false
    );
    return { files: exists ? [...purged.value.files, sessions] : purged.value.files };
  }

  async dispose(): Promise<void> {
    this.stopping = true;
    this.authorizer.cancelAll();
    await this.sessions.stop();
    await this.retrieval.close();
    await this.mcp.close();
    this.sessions.release();
    this.listeners.clear();
  }
}
