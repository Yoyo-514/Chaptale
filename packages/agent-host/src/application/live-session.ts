import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type { CreationApplication } from '@chaptale/creation/application';
import type { ContinueDeliveryInput, CreationResult } from '@chaptale/creation/contracts';

import { prefixMessages, systemPrompt } from '../instructions/instructions.ts';
import {
  type AgentInstructions,
  type EditMode,
  type HostChange,
  instructionsEntryType,
  modeEntryType,
  reviewContinuationMessageType,
  type SessionView
} from '../protocol.ts';
import { workWriteToolNames } from './creation-tools.ts';
import { messageView, transcriptView } from './message-view.ts';

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
function creationValue<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

export class LiveSession {
  readonly view: SessionView;
  readonly session: AgentSession;
  private readonly applied: AppliedInstructions;
  private readonly emit: (change: HostChange) => void;
  private readonly unsubscribe: () => void;
  private cancelled = false;
  private operation?: Promise<void>;
  private readonly creation?: CreationApplication;
  private readonly unsubscribeCreation?: () => void;
  private selectedMode: EditMode;
  private directAfterGroupId?: string;

  constructor(
    session: AgentSession,
    applied: AppliedInstructions,
    mode: EditMode,
    emit: (change: HostChange) => void,
    options?: { creation?: CreationApplication; directAfterGroupId?: string }
  ) {
    this.session = session;
    this.applied = applied;
    this.emit = emit;
    this.creation = options?.creation;
    this.selectedMode = mode;
    this.directAfterGroupId = options?.directAfterGroupId;
    this.view = {
      id: session.sessionId,
      sessionId: session.sessionId,
      name: session.sessionName,
      file: session.sessionFile!,
      cwd: session.sessionManager.getCwd(),
      model: session.model && { provider: session.model.provider, id: session.model.id },
      running: false,
      compacting: false,
      instructions: applied.entries,
      mode,
      messages: transcriptView(session.sessionManager)
    };
    this.view.usage = this.usage();
    this.refreshCreation();
    this.syncWorkTools();
    this.unsubscribe = session.subscribe(event => this.onEvent(event));
    this.unsubscribeCreation = this.creation?.subscribe(event => {
      const sessionId =
        event.change.kind === 'review'
          ? event.change.change.sessionId
          : event.change.kind === 'delivery'
            ? event.change.group.sessionId
            : undefined;
      if (sessionId !== this.view.sessionId) return;
      try {
        this.refreshCreation();
      } catch (error) {
        this.view.error = error instanceof Error ? error.message : String(error);
      }
      this.emit({ kind: 'session', session: this.view });
    });
  }

  async prompt(text: string): Promise<void> {
    const { view } = this;
    if (!text.trim()) throw new Error('消息不能为空');
    if (view.compacting) throw new Error('该会话正在运行压缩，请等待结束或停止后再发送');
    if (view.running) {
      // 重载与停止尚未进入可插话的生成阶段，失败交由界面保留草稿。
      if (this.cancelled || !this.session.isStreaming) throw new Error('会话正在启动或停止，请稍后再发送');
      await this.session.steer(text);
      return;
    }
    this.launch(() => this.session.prompt(text));
  }

  private launch(send: () => Promise<void>): void {
    const { view } = this;
    this.cancelled = false;
    view.running = true;
    delete view.error;
    this.emitRunning();
    this.operation = (async () => {
      try {
        // 修改后的指令在发送前 reload 生效；reload 期间再次修改的指令留到下一次发送。
        if (this.applied.entries !== view.instructions) {
          this.applied.entries = view.instructions;
          await this.session.reload();
          // SDK 重载会重新激活已注册工具，按重载结束时的模式恢复作品工具集合。
          this.syncWorkTools();
        }
        if (!this.cancelled) await send();
      } catch {
        view.error = '本次请求未完成，请检查模型设置或连接后重新发送';
      } finally {
        this.refreshUsage();
        view.running = false;
        this.emitRunning();
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
    this.emitRunning();
    this.operation = (async () => {
      try {
        await this.session.compact();
      } catch (error) {
        if (!this.cancelled) {
          const reason = error instanceof Error ? error.message : String(error);
          if (reason.includes('Nothing to compact')) view.error = '对话内容较少，暂时无需压缩';
          else if (reason.includes('Already compacted')) view.error = '对话已压缩，请继续交流后再试';
          else view.error = `压缩未完成：${reason}`;
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
    await this.session.abort();
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

  /** 延后切换只记录选择；作者继续对应组后按持久化进度投影生效。 */
  setMode(mode: EditMode): void {
    this.refreshCreation();
    let directAfterGroupId: string | undefined;
    if (mode === 'direct' && this.view.mode === 'review') {
      if (this.directAfterGroupId) directAfterGroupId = this.directAfterGroupId;
      else if (this.view.delivery && this.view.delivery.pendingCount > 0)
        directAfterGroupId = this.view.delivery.group.id;
    }
    const selectedMode = directAfterGroupId ? 'review' : mode;
    this.session.sessionManager.appendCustomEntry(modeEntryType, { mode: selectedMode, directAfterGroupId });
    this.selectedMode = selectedMode;
    this.directAfterGroupId = directAfterGroupId;
    this.refreshCreation();
    this.syncWorkTools();
    this.emit({ kind: 'session', session: this.view });
  }

  private refreshCreation(): void {
    const previousMode = this.view.mode;
    this.view.mode = this.selectedMode;
    delete this.view.switchingTo;
    if (this.creation) {
      this.view.delivery = creationValue(
        this.creation.executeAuthor({ method: 'readCurrentDelivery', input: { sessionId: this.view.sessionId! } })
      );
    }
    if (this.directAfterGroupId) {
      if (!this.creation) throw new Error('当前宿主未接入作品服务，无法恢复延后切换');
      const delivery = creationValue(
        this.creation.executeAuthor({ method: 'readDeliveryGroup', input: { groupId: this.directAfterGroupId } })
      );
      if (delivery.group.status === 'continued') this.view.mode = 'direct';
      else this.view.switchingTo = 'direct';
    }
    if (this.view.mode !== previousMode) this.syncWorkTools();
  }

  continueReview(input: Omit<ContinueDeliveryInput, 'sessionId'>): void {
    if (!this.creation) throw new Error('当前宿主未接入作品服务');
    const before = creationValue(
      this.creation.executeAuthor({ method: 'readDeliveryGroup', input: { groupId: input.groupId } })
    );
    if (this.view.running && before.group.status !== 'continued')
      throw new Error('会话正在运行，请等待当前请求结束后再继续');
    const group = creationValue(
      this.creation.executeAuthor({ method: 'continueDelivery', input: { ...input, sessionId: this.view.sessionId! } })
    );
    this.refreshCreation();
    this.emit({ kind: 'session', session: this.view });
    if (before.group.status === 'continued') return;
    const contents = creationValue(
      this.creation.executeAuthor({ method: 'readDeliveryContents', input: { groupId: group.id } })
    );
    this.launch(() =>
      this.session.sendCustomMessage(
        {
          customType: reviewContinuationMessageType,
          content: `作者已处理本组修改。以下是实际接受后的正式内容：\n${JSON.stringify(contents)}\n请根据这些正式修订继续剩余任务。`,
          display: true,
          details: { commandId: input.commandId, groupId: group.id }
        },
        { triggerTurn: true }
      )
    );
  }

  private syncWorkTools(): void {
    const names = this.session.getActiveToolNames().filter(name => !workWriteToolNames.has(name));
    if (this.view.mode !== 'discuss') {
      names.push(
        ...this.session
          .getAllTools()
          .filter(tool => workWriteToolNames.has(tool.name))
          .map(tool => tool.name)
      );
    }
    this.session.setActiveToolsByName(names);
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
    this.unsubscribeCreation?.();
  }

  private emitRunning(): void {
    const { id, running, compacting, error } = this.view;
    this.emit({ kind: 'running', id, running, compacting, error });
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

  private onEvent(event: AgentSessionEvent): void {
    const { view } = this;
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
    } else if (event.type === 'turn_end') {
      // message_end 早于 SDK 持久化；一轮结束时消息与工具结果已写入 JSONL。
      this.refreshUsage();
    } else if (event.type === 'compaction_start') {
      view.compacting = true;
      // cancel 可能发生在 compact() 内部的首次 await 与控制器创建之间。
      if (this.cancelled) this.session.abortCompaction();
      this.emitRunning();
    } else if (event.type === 'compaction_end') {
      view.compacting = false;
      if (event.result) {
        // 压缩前的对话保留显示并标记，总结插在记录位置。
        view.messages = transcriptView(this.session.sessionManager);
      }
      view.usage = this.usage();
      this.emit({ kind: 'session', session: view });
    }
  }
}
