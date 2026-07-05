import type { AgentRunOptions, AgentRuntime } from '@chaptale/agent-core';
import type { ChatMessage } from '@chaptale/shared';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { stringifyToolResult, toChatMessages } from '../agent/pi-agent-message.mapper';
import { PiAgentSessionFactory } from '../agent/pi-agent-session.factory';
import { flushSessionFile } from '../sessions/pi-session-file';
import type { PiModelService } from './pi-model.service';
import type { SettingsService } from './settings.service';

export type StreamOptions = AgentRunOptions;

function noop() {}

/**
 * 基于 pi SDK AgentSession 的 Agent 服务。
 *
 * 每个 Chaptale 会话对应一个 pi session 文件；AgentSession 按需创建并缓存，
 * 事件流转换为前端既有的 ChatMessage 协议。
 */
export class PiAgentService implements AgentRuntime {
  private sessions = new Map<string, Promise<AgentSession>>();
  private readonly sessionFactory: PiAgentSessionFactory;

  constructor(
    settingsService: SettingsService,
    private readonly modelService: PiModelService
  ) {
    this.sessionFactory = new PiAgentSessionFactory({ settingsService, modelService });
  }

  /** 会话目录/工作区切换后调用，丢弃缓存的 AgentSession。 */
  invalidateSessions() {
    for (const pending of this.sessions.values()) {
      void pending.then(session => session.dispose()).catch(() => undefined);
    }

    this.sessions.clear();
  }

  private getOrCreateSession(sessionId: string): Promise<AgentSession> {
    const cached = this.sessions.get(sessionId);

    if (cached) {
      return cached;
    }

    const created = this.createSession(sessionId);
    this.sessions.set(sessionId, created);
    created.catch(() => this.sessions.delete(sessionId));
    return created;
  }

  private createSession(sessionId: string): Promise<AgentSession> {
    return this.sessionFactory.create(sessionId);
  }

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    const session = await this.getOrCreateSession(sessionId);
    return session.messages.flatMap(message => toChatMessages(message));
  }

  async *stream(options: StreamOptions): AsyncGenerator<ChatMessage> {
    const { signal, query, sessionId } = options;
    const session = await this.getOrCreateSession(sessionId);

    // 默认模型可能在会话创建后被切换（或会话恢复了无凭据的旧模型），
    // 每次执行前同步为当前默认模型，避免拿旧模型/旧凭据请求导致 401/403。
    const defaultModel = await this.modelService.getDefaultPiModel();

    if (defaultModel && (session.model?.provider !== defaultModel.provider || session.model?.id !== defaultModel.id)) {
      await session.setModel(defaultModel);
    }

    if (!session.model) {
      throw new Error('尚未配置可用模型：请在设置面板 LLM Provider 中配置凭据并选择默认模型');
    }

    if (options.branchFromEntryId !== undefined) {
      if (options.branchFromEntryId) {
        session.sessionManager.branch(options.branchFromEntryId);
      } else {
        session.sessionManager.resetLeaf();
      }

      session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
    }

    // AgentSession 事件是回调风格，这里桥接为 AsyncGenerator 供 IPC 层消费
    const queue: ChatMessage[] = [];
    let done = false;
    let failure: Error | undefined;
    let wake: () => void = noop;

    const push = (message: ChatMessage) => {
      queue.push(message);
      wake();
    };

    const unsubscribe = session.subscribe((event: AgentSessionEvent) => {
      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
        push({
          type: 'assistant',
          partial: true,
          payload: { content: event.assistantMessageEvent.delta }
        });
        return;
      }

      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_start') {
        push({
          type: 'assistant',
          partial: true,
          payload: { content: '', reasoningStatus: 'streaming' }
        });
        return;
      }

      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_delta') {
        push({
          type: 'assistant',
          partial: true,
          payload: { content: '', reasoning: event.assistantMessageEvent.delta, reasoningStatus: 'streaming' }
        });
        return;
      }

      if (event.type === 'message_update' && event.assistantMessageEvent.type === 'thinking_end') {
        push({
          type: 'assistant',
          partial: true,
          payload: { content: '', reasoningStatus: 'done' }
        });
        return;
      }

      if (event.type === 'tool_execution_start') {
        push({
          type: 'tool_call',
          payload: {
            id: event.toolCallId,
            name: event.toolName,
            args: (event.args ?? {}) as Record<string, any>
          }
        });
        return;
      }

      if (event.type === 'tool_execution_end') {
        push({
          type: 'tool_result',
          payload: {
            tool_call_id: event.toolCallId,
            name: event.toolName,
            content: stringifyToolResult(event.result)
          }
        });
        return;
      }

      if (event.type === 'agent_end') {
        if (!event.willRetry) {
          const lastMessage = event.messages.at(-1);
          const errorMessage =
            lastMessage && 'stopReason' in lastMessage && lastMessage.stopReason === 'error'
              ? ((lastMessage as { errorMessage?: string }).errorMessage ?? '模型请求失败')
              : undefined;

          if (errorMessage && !signal.aborted) {
            failure = new Error(errorMessage);
          }

          done = true;
          wake();
        }
      }
    });

    const onAbort = () => {
      void session.abort();
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const promptPromise = session.prompt(query).catch((error: unknown) => {
        failure = error instanceof Error ? error : new Error(String(error));
        done = true;
        wake();
      });

      while (true) {
        if (queue.length > 0) {
          yield queue.shift()!;
          continue;
        }

        if (done) {
          break;
        }

        await new Promise<void>(resolve => {
          wake = resolve;
        });
        wake = noop;
      }

      await promptPromise;
      flushSessionFile(session.sessionManager);

      if (failure && !signal.aborted) {
        throw failure;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
    }
  }
}
