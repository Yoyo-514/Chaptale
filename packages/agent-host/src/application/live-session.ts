import type { AgentSession, AgentSessionEvent, ToolCallEvent, ToolResultEvent } from '@earendil-works/pi-coding-agent';

import type { CreationApplication } from '@chaptale/creation/application';

import { prefixMessages, systemPrompt } from '../instructions/instructions.ts';
import {
  type AgentInstructions,
  type EditMode,
  type EditorContext,
  type HostChange,
  type NestedToolView,
  type QueuedDelivery,
  type QueuedMessage,
  instructionsEntryType,
  modeEntryType,
  type SessionView
} from '../protocol.ts';
import { decodeUserPrompt, encodeUserPrompt, type SessionSkillsState } from '../skills/index.ts';
import { messageView, transcriptView } from './message-view.ts';
import { SessionReviewResults, withdrawBranchPendingChanges } from './review-results.ts';
import { navigateToBranchLeaf, rewindForMessageEdit } from './session-tree.ts';
import { composeToolTargetLookup, previewToolInput, toolResultInfo, toolTargetLookup } from './tool-result-info.ts';
import { workWriteToolNames } from './work-tools/index.ts';

/** 当前请求使用的指令；创建会话前交给 SDK 回调，之后在每次发送前更新。 */
export interface AppliedInstructions {
  entries: AgentInstructions;
}

/** 把指令接到 SDK：system 条目经 reload 生效，user/assistant 条目在每次请求时读取。 */
export function instructionCallbacks(applied: AppliedInstructions) {
  return {
    systemPrompt: () => systemPrompt(applied.entries),
    prefixMessages: (model: Parameters<typeof prefixMessages>[1]) => prefixMessages(applied.entries, model)
  };
}

/**
 * 可继续对话的会话：发送、取消、修改指令/模式/模型，并把 SDK 事件投影到界面视图。
 * 原生 AgentSession 由会话池持有和释放，这里只负责应用层状态。
 */
export class LiveSession {
  readonly view: SessionView;
  readonly session: AgentSession;
  private readonly applied: AppliedInstructions;
  private readonly emit: (change: HostChange) => void;
  private readonly unsubscribe: () => void;
  private cancelled = false;
  private reorderingQueue = false;
  private operation?: Promise<void>;
  private readonly reviewResults?: SessionReviewResults;
  private readonly creation?: CreationApplication;
  private readonly skills?: SessionSkillsState;
  private appliedGuidelines: string;

  constructor(
    session: AgentSession,
    applied: AppliedInstructions,
    mode: EditMode,
    emit: (change: HostChange) => void,
    options: { workId: string | null; creation?: CreationApplication; skills?: SessionSkillsState }
  ) {
    this.session = session;
    this.applied = applied;
    this.emit = emit;
    this.creation = options.creation;
    this.skills = options.skills;
    this.appliedGuidelines = this.currentGuidelines(options.workId);
    const initialTargets = composeToolTargetLookup(
      options.creation && toolTargetLookup(options.creation, session.sessionId, mode),
      options.skills &&
        ((input, toolName) => options.skills!.matchToolTarget(session.sessionManager.getCwd(), toolName, input))
    );
    this.view = {
      id: session.sessionId,
      sessionId: session.sessionId,
      name: session.sessionName,
      file: session.sessionFile!,
      workId: options.workId,
      model: session.model && { provider: session.model.provider, id: session.model.id },
      running: false,
      compacting: false,
      instructions: applied.entries,
      mode,
      messages: transcriptView(session.sessionManager, initialTargets),
      queued: []
    };
    this.view.usage = this.usage();
    if (options.creation) this.reviewResults = new SessionReviewResults(session, options.creation);
    this.syncWorkTools();
    this.unsubscribe = session.subscribe(event => this.onEvent(event));
  }

  async prompt(text: string, context?: EditorContext, delivery: QueuedDelivery = 'steer'): Promise<void> {
    const { view } = this;
    if (!text.trim()) throw new Error('消息不能为空');
    if (view.compacting) throw new Error('该会话正在运行压缩，请等待结束或停止后再发送');
    if (view.running) {
      // 重载与停止尚未进入可插话的生成阶段，拒收后由界面把该消息标为发送失败。
      if (this.cancelled || !this.session.isStreaming) throw new Error('会话正在启动或停止，请稍后再发送');
      const encoded = await encodeUserPrompt(text, context, view.workId, this.skills?.currentSkills() ?? []);
      const results = this.reviewResults?.prepare();
      if (results) await this.session.sendCustomMessage(results, { triggerTurn: false, deliverAs: delivery });
      if (delivery === 'followUp') await this.session.followUp(encoded);
      else await this.session.steer(encoded);
      return;
    }
    const model = this.session.model;
    if (!model) throw new Error('请先选择模型');
    const runtime = this.session.modelRuntime;
    const hasAuth =
      runtime.hasConfiguredAuth(model.provider) || (await runtime.checkAuth(model.provider)) !== undefined;
    if (!hasAuth) {
      throw new Error(`未配置供应商“${model.provider}”的 API 密钥，请在模型设置中填写后重试`);
    }
    await this.skills?.refresh();
    const encoded = await encodeUserPrompt(text, context, view.workId, this.skills?.currentSkills() ?? []);
    const results = this.reviewResults?.prepare();
    this.launch(async () => {
      if (results) {
        await this.session.sendCustomMessage(results, { triggerTurn: false });
        this.reviewResults!.acknowledge();
      }
      await this.session.prompt(encoded, { expandPromptTemplates: false });
    });
  }

  clearError(): void {
    if (!this.view.error && !this.view.noticeLevel) return;
    delete this.view.error;
    delete this.view.noticeLevel;
    this.emitRunning();
  }

  /** 撤回指定位置的待处理消息并按原序保留其余排队项；已被模型读取时返回 null。 */
  async dequeue(delivery: QueuedDelivery, index: number): Promise<QueuedMessage | null> {
    if (!Number.isInteger(index) || index < 0) return null;
    this.reorderingQueue = true;
    let removedRaw: string | undefined;
    try {
      const { steering, followUp } = this.session.clearQueue();
      const entries = [
        ...steering.map(raw => ({ delivery: 'steer' as const, raw })),
        ...followUp.map(raw => ({ delivery: 'followUp' as const, raw }))
      ];
      if (entries[index]?.delivery === delivery) removedRaw = entries.splice(index, 1)[0]!.raw;
      for (const item of entries) {
        if (item.delivery === 'followUp') await this.session.followUp(item.raw);
        else await this.session.steer(item.raw);
      }
    } finally {
      this.reorderingQueue = false;
      this.syncQueue();
    }
    if (removedRaw === undefined) return null;
    return { delivery, ...decodeUserPrompt(removedRaw) };
  }

  /** 基于目标作者消息在原生会话树原地分叉并重发。 */
  async editMessage(entryId: string, text: string, context?: EditorContext, discardPending = false): Promise<void> {
    if (!text.trim()) throw new Error('消息不能为空');
    if (this.view.running || this.view.compacting) throw new Error('请在当前操作结束后再编辑或重发消息');
    const manager = this.session.sessionManager;
    const entry = manager.getEntry(entryId);
    if (!entry || entry.type !== 'message' || entry.message.role !== 'user') throw new Error('目标作者消息不存在');
    if (this.creation) {
      withdrawBranchPendingChanges(this.creation, this.session.sessionId, discardPending);
      this.reviewResults?.reset();
    }
    await rewindForMessageEdit(this.session, entryId, this.view.instructions, this.view.mode!);
    this.syncWorkTools();
    this.view.messages = transcriptView(manager, this.toolTargets());
    this.view.usage = this.usage();
    delete this.view.error;
    delete this.view.noticeLevel;
    this.emit({ kind: 'session', session: this.view });
    await this.prompt(text, context);
  }

  /** 切换到原生会话树的另一分支叶子，并落盘记录当前活动分支。 */
  async switchBranch(leafId: string, discardPending = false): Promise<void> {
    if (this.view.running || this.view.compacting) throw new Error('请在当前操作结束后再切换分支');
    const manager = this.session.sessionManager;
    if (!manager.getEntry(leafId)) throw new Error('目标分支节点不存在');
    if (this.creation) {
      withdrawBranchPendingChanges(this.creation, this.session.sessionId, discardPending);
      this.reviewResults?.reset();
    }
    const records = await navigateToBranchLeaf(this.session, leafId);
    if (records.instructions) this.view.instructions = records.instructions;
    if (records.mode) this.view.mode = records.mode;
    this.syncWorkTools();
    this.view.messages = transcriptView(manager, this.toolTargets());
    this.view.usage = this.usage();
    delete this.view.error;
    delete this.view.noticeLevel;
    this.emit({ kind: 'session', session: this.view });
  }

  private launch(send: () => Promise<void>): void {
    const { view } = this;
    this.cancelled = false;
    view.running = true;
    delete view.error;
    delete view.noticeLevel;
    delete view.retrying;
    this.emitRunning();
    this.operation = (async () => {
      try {
        const guidelines = this.currentGuidelines(view.workId);
        const skillsReload = this.skills?.consumeReload() === true;
        // 修改后的指令、作品写作要求与技能索引在发送前 reload 生效；reload 期间再次修改的留到下一次发送。
        if (this.applied.entries !== view.instructions || this.appliedGuidelines !== guidelines || skillsReload) {
          this.applied.entries = view.instructions;
          this.appliedGuidelines = guidelines;
          await this.session.reload();
          // SDK 重载会重新激活已注册工具，按重载结束时的模式恢复作品工具集合。
          this.syncWorkTools();
        }
        if (!this.cancelled) await send();
      } catch (cause) {
        if (!this.cancelled) {
          view.error = cause instanceof Error ? cause.message : String(cause);
          view.noticeLevel = 'error';
        }
      } finally {
        delete view.retrying;
        view.messages = transcriptView(this.session.sessionManager, this.toolTargets());
        view.queued = this.readQueue();
        this.refreshUsage();
        view.running = false;
        this.emit({ kind: 'session', session: view });
        this.emitRunning();
        try {
          this.reviewResults?.acknowledge();
        } catch (error) {
          view.error = error instanceof Error ? error.message : String(error);
          view.noticeLevel = 'error';
          this.emit({ kind: 'session', session: view });
        }
      }
    })();
  }

  /** 先占用会话，再进入会中止当前运行的 SDK 手动压缩入口。 */
  compact(): void {
    const { view } = this;
    if (view.running) throw new Error('该会话正在运行，请等待结束或停止后再压缩');
    this.cancelled = false;
    view.running = true;
    view.compacting = true;
    delete view.error;
    delete view.noticeLevel;
    delete view.retrying;
    this.emitRunning();
    this.operation = (async () => {
      try {
        await this.session.compact();
      } catch (error) {
        if (!this.cancelled) {
          const reason = error instanceof Error ? error.message : String(error);
          if (reason.includes('Nothing to compact')) {
            view.error = '对话内容较少，暂时无需压缩';
            view.noticeLevel = 'info';
          } else if (reason.includes('Already compacted')) {
            view.error = '对话已压缩，请继续交流后再试';
            view.noticeLevel = 'info';
          } else {
            view.error = `压缩未完成：${reason}`;
            view.noticeLevel = 'error';
          }
        }
      } finally {
        view.running = false;
        view.compacting = false;
        this.refreshUsage();
        this.emitRunning();
      }
    })();
  }

  /** 取消当前运行并等待它结束；会话仍可继续使用。 */
  async stop(): Promise<void> {
    this.cancelled = true;
    this.emit({ kind: 'session', session: this.view });
    await this.session.abort();
    this.session.clearQueue();
    this.syncQueue();
    await this.operation;
  }

  /** 记入历史并在下一次发送时生效。 */
  setInstructions(entries: AgentInstructions): void {
    this.session.sessionManager.appendCustomEntry(instructionsEntryType, { entries });
    this.view.instructions = entries;
    this.emit({ kind: 'session', session: this.view });
  }

  rename(name: string): void {
    const value = name.trim();
    if (!value) throw new Error('会话名称不能为空');
    this.session.setSessionName(value);
    this.view.name = value;
    this.emit({ kind: 'session', session: this.view });
  }

  /** 切换立即作用于后续作品写入；已开始的单次保存沿用其调用时模式。 */
  setMode(mode: EditMode): void {
    this.session.sessionManager.appendCustomEntry(modeEntryType, { mode });
    this.view.mode = mode;
    this.syncWorkTools();
    this.emit({ kind: 'session', session: this.view });
  }
  /** 讨论模式撤下全部作品写工具（包括 tool_search 加载的）；其他模式补回常驻写工具，保留已加载的工具。 */
  syncWorkTools(): void {
    const active = this.session.getActiveToolNames();
    const next =
      this.view.mode === 'discuss'
        ? active.filter(name => !workWriteToolNames.has(name))
        : [
            ...new Set([
              ...active,
              ...this.session
                .getAllTools()
                .filter(tool => workWriteToolNames.has(tool.name) && tool.exposure !== 'deferred')
                .map(tool => tool.name)
            ])
          ];
    // 每次请求前都会校正，没有变化时不让 pi 重建提示词。
    if (next.length !== active.length) this.session.setActiveToolsByName(next);
  }

  async setModel(model: Parameters<AgentSession['setModel']>[0]): Promise<void> {
    if (this.view.running) throw new Error('请在当前请求结束后切换模型');
    await this.session.setModel(model);
    this.view.model = { provider: model.provider, id: model.id };
    this.view.usage = this.usage();
    this.emit({ kind: 'session', session: this.view });
  }

  /** 停止转发事件；原生会话由会话池释放。 */
  detach(): void {
    this.unsubscribe();
  }

  private currentGuidelines(workId: string | null): string {
    if (!workId || !this.creation) return '';
    const result = this.creation.executeAuthor({ method: 'readWritingGuidelines', input: { workId } });
    return result.ok ? result.value.trim() : '';
  }

  private readQueue(): QueuedMessage[] {
    return [
      ...this.session.getSteeringMessages().map(raw => ({ delivery: 'steer' as const, ...decodeUserPrompt(raw) })),
      ...this.session.getFollowUpMessages().map(raw => ({ delivery: 'followUp' as const, ...decodeUserPrompt(raw) }))
    ];
  }

  private syncQueue(): void {
    this.view.queued = this.readQueue();
    this.emit({ kind: 'queue', id: this.view.id, queued: this.view.queued });
  }

  private emitRunning(): void {
    const { id, running, compacting, error, noticeLevel, retrying } = this.view;
    this.emit({ kind: 'running', id, running, compacting, error, noticeLevel, retrying });
  }

  private usage() {
    const { tokens, contextUsage } = this.session.getSessionStats();
    return {
      input: tokens.input,
      output: tokens.output,
      cacheRead: tokens.cacheRead,
      cacheWrite: tokens.cacheWrite,
      context: contextUsage
    };
  }

  private refreshUsage(): void {
    this.view.usage = this.usage();
    this.emit({ kind: 'usage', id: this.view.id, usage: this.view.usage });
  }

  private findToolCall(id: string, nested = false) {
    for (let index = this.view.messages.length - 1; index >= 0; index--) {
      const message = this.view.messages[index];
      const tool = message.tools.find(call => call.id === id || (nested && id.startsWith(`${call.id}/`)));
      if (tool) return { index, message, tool };
    }
    return undefined;
  }

  /** 只投影 SDK 生命周期；调用、授权、调度和最终嵌套记录仍由 SDK 负责。 */
  toolActivity(event: ToolCallEvent | ToolResultEvent): void {
    if (!event.parentToolCallId) return;
    const parent = this.findToolCall(event.parentToolCallId, true);
    if (!parent || this.view.messages.slice(parent.index + 1).some(message => message.toolCallId === parent.tool.id))
      return;
    const calls = (parent.tool.nestedTools ??= []);
    let call: NestedToolView;
    if (event.type === 'tool_call') {
      call = {
        id: event.toolCallId,
        name: event.toolName,
        preview: previewToolInput(event.input),
        status: 'running',
        info: this.toolTargets()?.(event.input, event.toolName)
      };
      calls.push(call);
    } else {
      call = calls.find(item => item.id === event.toolCallId)!;
      const info = toolResultInfo(event.details ?? event.structuredContent) ?? call.info;
      call.status = event.isError ? 'error' : 'ok';
      call.info = info;
      if (event.isError)
        call.error =
          info?.error ??
          event.content
            .filter(block => block.type === 'text')
            .map(block => block.text)
            .join('\n');
    }
    this.emit({ kind: 'tool', id: this.view.id, index: parent.index, parentCallId: parent.tool.id, call });
  }

  private toolTargets() {
    return composeToolTargetLookup(
      this.creation && toolTargetLookup(this.creation, this.session.sessionId, this.view.mode!),
      this.skills &&
        ((input, toolName) => this.skills!.matchToolTarget(this.session.sessionManager.getCwd(), toolName, input))
    );
  }

  private onEvent(event: AgentSessionEvent): void {
    const { view } = this;
    if (event.type === 'message_start') {
      if (event.message.role === 'assistant') {
        if (view.retrying) {
          delete view.retrying;
          this.emitRunning();
        }
        const persisted = transcriptView(this.session.sessionManager, this.toolTargets(), { running: view.running });
        const prevIndex = view.messages.length - 1;
        if (prevIndex >= 0 && persisted[prevIndex]?.role === 'user') {
          view.messages[prevIndex] = persisted[prevIndex]!;
          this.emit({ kind: 'message', id: view.id, index: prevIndex, message: persisted[prevIndex]! });
        }
      }
      const message = messageView(event.message, this.toolTargets());
      if (event.message.role === 'toolResult') {
        const parent = this.findToolCall(event.message.toolCallId);
        if (parent) delete parent.tool.nestedTools;
      }
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
      const message = messageView(event.message, this.toolTargets());
      view.messages[index] = message;
      this.emit({ kind: 'message', id: view.id, index, message });
    } else if (event.type === 'turn_end') {
      // message_end 早于 SDK 持久化；一轮结束时消息与工具结果已写入 JSONL。
      this.refreshUsage();
    } else if (event.type === 'queue_update') {
      if (this.reorderingQueue) return;
      view.queued = [
        ...event.steering.map(raw => ({ delivery: 'steer' as const, ...decodeUserPrompt(raw) })),
        ...event.followUp.map(raw => ({ delivery: 'followUp' as const, ...decodeUserPrompt(raw) }))
      ];
      this.emit({ kind: 'queue', id: view.id, queued: view.queued });
    } else if (event.type === 'auto_retry_start') {
      view.retrying = {
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        delayMs: event.delayMs,
        errorMessage: event.errorMessage
      };
      if (this.cancelled) this.session.abortRetry();
      this.emitRunning();
    } else if (event.type === 'auto_retry_end') {
      delete view.retrying;
      this.emitRunning();
    } else if (event.type === 'entry_appended' && event.entry.type === 'context_edit') {
      view.messages = transcriptView(this.session.sessionManager, this.toolTargets(), { running: view.running });
      this.emit({ kind: 'session', session: view });
    } else if (event.type === 'compaction_start') {
      view.compacting = true;
      // cancel 可能发生在 compact() 内部的首次 await 与控制器创建之间。
      if (this.cancelled) this.session.abortCompaction();
      this.emitRunning();
    } else if (event.type === 'compaction_end') {
      view.compacting = false;
      if (event.result) {
        // 压缩前的对话保留显示并标记，总结插在记录位置。
        view.messages = transcriptView(this.session.sessionManager, this.toolTargets(), { running: view.running });
      }
      view.usage = this.usage();
      this.emit({ kind: 'session', session: view });
    }
  }
}
