import type {
  AgentClearedQueue,
  AgentRunOptions,
  AgentRunScope,
  AgentRuntime,
  AgentSteerOptions
} from '@chaptale/ipc-contract';
import type { ChatMessage, SkillInvocation } from '@chaptale/shared';
import { errorToMessage, formatSkillInvocation, parseSkillInvocation } from '@chaptale/shared';
import type { ImageContent } from '@earendil-works/pi-ai/compat';
import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import { ImageAttachmentService } from '../../../modules/attachments/service';
import { ContextFileService } from '../../../modules/context/service';
import { decodeContextMessage } from '../../../modules/context/context-message-codec';
import { createMemoryInjector, type MemoryInjector } from '../../../modules/memory/injector';
import { decodeMemoryMessage } from '../../../modules/memory/message-codec';
import { flushSessionFile } from '../sessions/file';
import { getPiUserEntrySnapshot } from '../sessions/user-entry-snapshot';
import type { PiModelService } from '../models/service';
import type { SettingsService } from '../../../modules/settings/service';
import { SkillsProvider } from '../skills/provider';
import { AsyncMessageQueue } from './async-message-queue';
import { mapAgentStreamEvent } from './event-mapper';
import { PiAgentSessionFactory } from './session-factory';

export type StreamOptions = AgentRunOptions;

/** 普通 prompt 与 steer 共享的文本、会话和附件输入。 */
type AgentInputOptions = Pick<AgentRunOptions, 'query' | 'sessionId' | 'contextFilePaths' | 'reuseUserEntryId'>;

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
  private readonly memoryInjector: MemoryInjector;
  readonly skillsProvider: SkillsProvider;

  constructor(
    private readonly settingsService: SettingsService,
    private readonly modelService: PiModelService,
    private readonly imageAttachmentService = new ImageAttachmentService(),
    skillsProvider = new SkillsProvider(settingsService),
    memoryInjector?: MemoryInjector
  ) {
    this.skillsProvider = skillsProvider;
    this.memoryInjector = memoryInjector ?? createMemoryInjector(settingsService.rootDir);
    this.sessionFactory = new PiAgentSessionFactory({ settingsService, modelService, skillsProvider });
  }

  /** 会话目录/工作区切换后调用，丢弃缓存的 AgentSession与记忆注入去重记录。 */
  invalidateSessions() {
    for (const pending of this.sessions.values()) {
      void pending.then(session => session.dispose()).catch(() => undefined);
    }

    this.sessions.clear();
    this.memoryInjector.reset();
  }

  /**
   * 按会话 ID 复用创建中的 Promise，避免并发请求为同一持久化文件构造多个 AgentSession。
   * 创建失败时移除缓存，使下一次运行可以重试初始化。
   */
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

      // 中断代表结束整次运行，必须先清掉 queued steer，避免 abort 后又触发续跑。
      try {
        session.clearQueue();
      } catch {
        // 清队列失败不应阻止底层运行被中断。
      }

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
      let skipInitialUserMessageStart = true;
      unsubscribe = session.subscribe((event: AgentSessionEvent) => {
        // 初始用户消息已在 prompt 前显式 yield；后续 user message_start 才是被 SDK 消费的 steer。
        if (event.type === 'message_start' && event.message.role === 'user' && skipInitialUserMessageStart) {
          skipInitialUserMessageStart = false;
          return;
        }

        const mapping = mapAgentStreamEvent(event, { aborted: signal.aborted });

        if (mapping.message) {
          queue.push(mapping.message);
        }

        if (mapping.done) {
          queue.finish();
        }
      });
      signal.throwIfAborted();

      // 记忆注入仅限新发 prompt：复用历史条目需逐字重现原 prompt，steer 保持轻量（均不注入）。
      const memoryPrefix = options.reuseUserEntryId
        ? ''
        : await this.memoryInjector.resolvePrefix(sessionId, await this.settingsService.getCurrentCwd());
      const runContext = await this.resolveRunContext(options, skillInvocation, reusedContext, memoryPrefix);
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

  /**
   * 向活跃 Pi AgentSession 追加 steer；运行结束时绝不退化为普通 prompt。
   * 注意不走 prepareSession：reload 会重建 runtime、setModel 会改写运行中的 agent 状态，
   * 两者都不得在活跃运行中触发；skill 命令由 Pi steer() 自身展开。
   */
  async steer(options: AgentSteerOptions): Promise<void> {
    options.signal.throwIfAborted();
    const skillInvocation = parseSkillInvocation(options.query);
    const session = await this.getOrCreateSession(options.sessionId);
    options.signal.throwIfAborted();

    if (!session.isStreaming) {
      throw new Error('Agent 运行已结束，无法发送 steer');
    }

    const runContext = await this.resolveRunContext(options, skillInvocation, undefined);
    options.signal.throwIfAborted();

    // 上下文文件解析包含异步 IO，结束后必须复查，避免消息滞留在已经停止的会话队列。
    if (!session.isStreaming) {
      throw new Error('Agent 运行已结束，无法发送 steer');
    }

    await session.steer(runContext.promptText, runContext.promptImages);
  }

  /** 清空 Pi 会话中尚未消费的 steering 与 follow-up 队列。 */
  async clearPendingMessages(scope: AgentRunScope): Promise<AgentClearedQueue> {
    scope.signal.throwIfAborted();
    const session = await this.getOrCreateSession(scope.sessionId);
    scope.signal.throwIfAborted();
    const { steering, followUp } = session.clearQueue();
    return { steering, followUp };
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

  /**
   * 将可选分支指令同步到 SessionManager 与 Agent 内存上下文。
   * undefined 表示沿用当前叶子，null 表示回到根分支，字符串表示从指定历史条目继续。
   */
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
    options: AgentInputOptions,
    skillInvocation: SkillInvocation | undefined,
    reusedContext: ReusedUserEntryContext,
    memoryPrefix = ''
  ): Promise<AgentRunContext> {
    const resolvedContext = reusedContext ? undefined : await this.contextFileService.resolve(options.contextFilePaths);
    // 上下文信封单独解码（其正则锚定行首）；复用的历史前缀可能自带 memory 信封，先剔除再解。
    const contextPrefix = reusedContext?.promptPrefix ?? resolvedContext!.promptPrefix;
    const decodedContext = decodeContextMessage(decodeMemoryMessage(contextPrefix).text);
    // 记忆信封排在最前：它是变化频率最低的前缀，有利于 provider 前缀缓存。
    const promptPrefix = `${memoryPrefix}${contextPrefix}`;
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
