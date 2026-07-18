import type { AgentRunOptions, AgentRuntime } from '@chaptale/ipc-contract';
import type { ChatMessage, SkillInvocation } from '@chaptale/shared';
import { errorToMessage, formatSkillInvocation, parseSkillInvocation } from '@chaptale/shared';
import type { ImageContent } from '@earendil-works/pi-ai/compat';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { ImageAttachmentService } from '../../../modules/attachments/service';
import { ContextFileService } from '../../../modules/context/service';
import { decodeContextMessage } from '../../../modules/context/context-message-codec';
import { flushSessionFile } from '../sessions/file';
import { getPiUserEntrySnapshot } from '../sessions/user-entry-snapshot';
import type { PiModelService } from '../models/service';
import type { SettingsService } from '../../../modules/settings/service';
import { SkillsProvider } from '../skills/provider';
import { AsyncMessageQueue } from './async-message-queue';
import { mapAgentStreamEvent } from './event-mapper';
import { PiAgentSessionFactory } from './session-factory';

export type StreamOptions = AgentRunOptions;

type ReusedUserEntryContext = ReturnType<typeof getPiUserEntrySnapshot> | undefined;

type AgentRunContext = {
  userMessage: ChatMessage;
  promptText: string;
  promptImages: ImageContent[];
};

/**
 * AgentRuntime 的 Pi 适配边界。
 *
 * 每个 Chaptale 会话对应一个 pi session 文件；上游 AgentSession 只在 integrations 内缓存，
 * 事件与图片在离开该边界前转换为应用协议。
 */
export class PiAgentService implements AgentRuntime {
  private sessions = new Map<string, Promise<AgentSession>>();
  private readonly contextFileService = new ContextFileService();
  private readonly sessionFactory: PiAgentSessionFactory;
  readonly skillsProvider: SkillsProvider;

  constructor(
    settingsService: SettingsService,
    private readonly modelService: PiModelService,
    private readonly imageAttachmentService = new ImageAttachmentService(),
    skillsProvider = new SkillsProvider(settingsService)
  ) {
    this.skillsProvider = skillsProvider;
    this.sessionFactory = new PiAgentSessionFactory({ settingsService, modelService, skillsProvider });
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

  async *stream(options: StreamOptions): AsyncGenerator<ChatMessage> {
    const { signal, query, sessionId } = options;
    signal.throwIfAborted();

    const skillInvocation = parseSkillInvocation(query);
    const session = await this.prepareSession(sessionId, Boolean(skillInvocation));
    let abortHandled = false;
    const onAbort = () => {
      if (abortHandled) {
        return;
      }

      abortHandled = true;

      try {
        void Promise.resolve(session.abort()).catch(() => undefined);
      } catch {
        return;
      }
    };
    signal.addEventListener('abort', onAbort, { once: true });

    // AbortSignal 不会为已发生的 abort 补发事件；安装 listener 后必须立即补偿检查。
    if (signal.aborted) {
      onAbort();
    }

    let unsubscribe: (() => void) | undefined;

    try {
      signal.throwIfAborted();

      const reusedContext = options.reuseUserEntryId
        ? getPiUserEntrySnapshot(session.sessionManager, options.reuseUserEntryId)
        : undefined;

      this.applyBranch(session, options.branchFromEntryId);

      // AgentSession 事件是回调风格，经 AsyncMessageQueue 桥接为 AsyncGenerator 供 IPC 层消费
      const queue = new AsyncMessageQueue<ChatMessage>();
      unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        const mapping = mapAgentStreamEvent(event, { aborted: signal.aborted });

        if (mapping.message) {
          queue.push(mapping.message);
        }

        if (mapping.done) {
          queue.finish();
        }
      });
      signal.throwIfAborted();

      const runContext = await this.resolveRunContext(options, skillInvocation, reusedContext);
      signal.throwIfAborted();

      yield runContext.userMessage;
      signal.throwIfAborted();

      const promptPromise = session
        .prompt(runContext.promptText, { images: runContext.promptImages })
        .catch((error: unknown) => {
          queue.finish(error instanceof Error ? error : new Error(errorToMessage(error)));
        });

      for await (const message of queue.drain()) {
        signal.throwIfAborted();
        yield message;
        signal.throwIfAborted();
      }

      signal.throwIfAborted();
      await promptPromise;
      signal.throwIfAborted();
      flushSessionFile(session.sessionManager);

      if (queue.failure) {
        throw queue.failure;
      }
    } finally {
      signal.removeEventListener('abort', onAbort);
      unsubscribe?.();
    }
  }

  /** 取回（或创建）缓存会话，并保证 skills 定义与默认模型和当前设置一致。 */
  private async prepareSession(sessionId: string, hasSkillInvocation: boolean): Promise<AgentSession> {
    const session = await this.getOrCreateSession(sessionId);

    // 显式 skill 命令应读取磁盘上的最新定义，避免命令菜单已刷新但缓存会话仍持有旧 skills。
    if (hasSkillInvocation) {
      await session.reload();
    }

    // 默认模型可能在会话创建后被切换（或会话恢复了无凭据的旧模型），
    // 每次执行前同步为当前默认模型，避免拿旧模型/旧凭据请求导致 401/403。
    const defaultModel = await this.modelService.getDefaultPiModel();

    if (defaultModel && (session.model?.provider !== defaultModel.provider || session.model?.id !== defaultModel.id)) {
      await session.setModel(defaultModel);
    }

    if (!session.model) {
      throw new Error('尚未配置可用模型：请在设置面板 LLM Provider 中配置凭据并选择默认模型');
    }

    return session;
  }

  private applyBranch(session: AgentSession, branchFromEntryId: string | null | undefined) {
    if (branchFromEntryId === undefined) {
      return;
    }

    if (branchFromEntryId) {
      session.sessionManager.branch(branchFromEntryId);
    } else {
      session.sessionManager.resetLeaf();
    }

    session.agent.state.messages = session.sessionManager.buildSessionContext().messages;
  }

  /** 解析上下文文件与图片附件，产出用户消息、最终 prompt 文本与随行图片。 */
  private async resolveRunContext(
    options: StreamOptions,
    skillInvocation: SkillInvocation | undefined,
    reusedContext: ReusedUserEntryContext
  ): Promise<AgentRunContext> {
    const resolvedContext = reusedContext ? undefined : await this.contextFileService.resolve(options.contextFilePaths);
    const promptPrefix = reusedContext?.promptPrefix ?? resolvedContext!.promptPrefix;
    const decodedContext = decodeContextMessage(promptPrefix);
    // 复用历史消息时保留原始 content 下标，保证 session-entry source 与 readOriginal 对齐；
    // 新发送时 pi 会把消息持久化为 [text, ...images]，图片真实下标从 1 开始。
    const imageBlocks = reusedContext
      ? reusedContext.imageBlocks
      : (resolvedContext?.images ?? []).map((image, index) => ({
          type: image.type,
          data: image.data,
          mimeType: image.mimeType,
          blockIndex: index + 1
        }));
    const promptImages = imageBlocks.map(image => ({
      type: image.type,
      data: image.data,
      mimeType: image.mimeType
    }));
    const imagePaths = resolvedContext?.imagePaths ?? [];
    const presentation = this.imageAttachmentService.createPresentation(imageBlocks, blockIndex => {
      if (options.reuseUserEntryId) {
        return {
          type: 'session-entry',
          sessionId: options.sessionId,
          entryId: options.reuseUserEntryId,
          blockIndex
        };
      }

      const imagePath = imagePaths[blockIndex - 1];
      return imagePath ? { type: 'context-file', path: imagePath } : undefined;
    });
    const displayText = skillInvocation?.arguments ?? options.query;
    const userContent =
      presentation.attachments.length > 0
        ? [...(displayText ? [{ type: 'text' as const, text: displayText }] : []), ...presentation.attachments]
        : displayText;

    // pi 只在文本以 /skill: 开头时执行原生展开；附件信封因此作为命令参数注入，而不是放在命令前。
    const promptText = skillInvocation
      ? formatSkillInvocation({
          ...skillInvocation,
          arguments: `${promptPrefix}${skillInvocation.arguments}`.trim()
        })
      : `${promptPrefix}${options.query}`;

    return {
      userMessage: {
        role: 'user',
        content: userContent,
        ...(decodedContext.contextFiles.length > 0 ? { contextFiles: decodedContext.contextFiles } : {}),
        ...(skillInvocation ? { skillInvocation } : {}),
        timestamp: Date.now()
      },
      promptText,
      promptImages
    };
  }
}
