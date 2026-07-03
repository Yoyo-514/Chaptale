import type { ChatMessage } from '@chaptale/shared';
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  type AgentSession,
  type AgentSessionEvent,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent';
import { Type } from 'typebox';

import { chaptaleSystemPrompt, systemPrompt } from '../prompt';
import type { PiModelService } from './pi-model.service';
import type { SettingsService } from './settings.service';
import { websearch } from './tools.service';

export type StreamOptions = {
  signal: AbortSignal;
  query: string;
  sessionId?: string;
};

/**
 * 联网搜索工具（pi ToolDefinition 版）。
 *
 * 创作场景默认不开启 pi 的文件/命令工具（read/bash/edit/write），
 * 只注册白名单自定义工具，符合“Custom Agent 默认不能执行破坏性操作”的约束。
 */
const websearchTool: ToolDefinition<ReturnType<typeof Type.Object>> = {
  name: 'websearch',
  label: '联网搜索',
  description: '通过网络搜索获取信息',
  parameters: Type.Object({
    keywords: Type.String({
      description:
        '搜索查询字符串。可以是简单关键词组合，也可以使用 Bing 搜索运算符构造精确查询。例如："rust programming" +cargo'
    })
  }),
  async execute(_toolCallId, params, signal) {
    const results = await websearch({ keywords: (params as { keywords: string }).keywords }, signal);
    return {
      content: [{ type: 'text' as const, text: JSON.stringify(results) }],
      details: results
    };
  }
};

/**
 * 基于 pi SDK AgentSession 的 Agent 服务。
 *
 * 每个 Chaptale 会话对应一个 pi session 文件；AgentSession 按需创建并缓存，
 * 事件流转换为前端既有的 ChatMessage 协议。
 */
export class PiAgentService {
  private sessions = new Map<string, Promise<AgentSession>>();

  constructor(
    private readonly settingsService: SettingsService,
    private readonly modelService: PiModelService
  ) {}

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

  private async createSession(sessionId: string): Promise<AgentSession> {
    const [cwd, sessionDir] = await Promise.all([
      this.settingsService.getCurrentCwd(),
      this.settingsService.getCurrentSessionDir()
    ]);

    const sessions = await SessionManager.list(cwd, sessionDir);
    const target = sessions.find(item => item.id === sessionId);

    if (!target) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    const sessionManager = SessionManager.open(target.path, sessionDir, cwd);
    const settingsManager = SettingsManager.create(cwd, this.settingsService.agentDir);

    // Chaptale 自己的角色 & 创作系统提示词，覆盖 pi 默认 coding 系统提示词；
    // 同时关闭 extensions / 项目上下文文件扫描，避免把 pi CLI 的 coding 行为带进创作会话。
    const resourceLoader = new DefaultResourceLoader({
      cwd,
      agentDir: this.settingsService.agentDir,
      settingsManager,
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
      systemPrompt: [systemPrompt, chaptaleSystemPrompt].join('\n\n')
    });
    await resourceLoader.reload();

    const { session } = await createAgentSession({
      cwd,
      agentDir: this.settingsService.agentDir,
      authStorage: this.modelService.getAuthStorage(),
      modelRegistry: this.modelService.getModelRegistry(),
      sessionManager,
      settingsManager,
      resourceLoader,
      // 创作场景：只允许显式注册的白名单工具，避免暴露 read/bash/edit/write 等 coding 工具。
      tools: ['websearch'],
      customTools: [websearchTool]
    });

    return session;
  }

  async getHistory(sessionId: string): Promise<ChatMessage[]> {
    const session = await this.getOrCreateSession(sessionId);
    return session.messages.flatMap(message => toChatMessages(message));
  }

  async *stream(options: StreamOptions): AsyncGenerator<ChatMessage> {
    const { signal, query, sessionId } = options;

    if (!sessionId) {
      throw new Error('缺少 sessionId：Agent 流式执行需要绑定具体会话');
    }

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

    // AgentSession 事件是回调风格，这里桥接为 AsyncGenerator 供 IPC 层消费
    const queue: ChatMessage[] = [];
    let done = false;
    let failure: Error | undefined;
    let wake = () => {};

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

      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await new Promise<void>(resolve => {
            wake = resolve;
          });
          continue;
        }

        yield queue.shift()!;
      }

      await promptPromise;

      if (failure && !signal.aborted) {
        throw failure;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      unsubscribe();
    }
  }
}

function stringifyToolResult(result: unknown): string {
  if (result && typeof result === 'object' && 'content' in result) {
    const content = (result as { content: unknown }).content;

    if (Array.isArray(content)) {
      const text = content
        .filter((item): item is { type: 'text'; text: string } =>
          Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text')
        )
        .map(item => item.text)
        .join('\n');

      if (text) {
        return text;
      }
    }
  }

  return JSON.stringify(result ?? null);
}

/** 将 pi AgentMessage 转换为前端 ChatMessage（用于历史回放）。 */
function toChatMessages(message: unknown): ChatMessage[] {
  if (!message || typeof message !== 'object') {
    return [];
  }

  const record = message as Record<string, unknown>;

  if (record.role === 'user') {
    const content = record.content;
    const text =
      typeof content === 'string'
        ? content
        : Array.isArray(content)
          ? content
              .filter((item): item is { type: 'text'; text: string } =>
                Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'text')
              )
              .map(item => item.text)
              .join('\n')
          : '';

    return text ? [{ type: 'user', payload: { content: text } }] : [];
  }

  if (record.role === 'assistant') {
    const content = Array.isArray(record.content) ? record.content : [];
    const messages: ChatMessage[] = [];

    for (const item of content) {
      if (!item || typeof item !== 'object') {
        continue;
      }

      const block = item as Record<string, unknown>;

      if (block.type === 'text' && typeof block.text === 'string' && block.text) {
        messages.push({ type: 'assistant', payload: { content: block.text } });
      }

      if (block.type === 'toolCall') {
        messages.push({
          type: 'tool_call',
          payload: {
            id: typeof block.id === 'string' ? block.id : '',
            name: typeof block.name === 'string' ? block.name : 'tool',
            args: block.arguments && typeof block.arguments === 'object' ? (block.arguments as Record<string, any>) : {}
          }
        });
      }
    }

    return messages;
  }

  if (record.role === 'toolResult') {
    return [
      {
        type: 'tool_result',
        payload: {
          tool_call_id: typeof record.toolCallId === 'string' ? record.toolCallId : '',
          name: typeof record.toolName === 'string' ? record.toolName : 'tool',
          content: stringifyToolResult(record)
        }
      }
    ];
  }

  return [];
}
