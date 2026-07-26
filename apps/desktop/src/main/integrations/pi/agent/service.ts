import type { AgentSession, AgentSessionEvent } from '@earendil-works/pi-coding-agent';

import type {
  AgentClearedQueue,
  AgentRunOptions,
  AgentRunScope,
  AgentRuntime,
  AgentSteerOptions
} from '@chaptale/ipc-contract';
import type { ChatMessage, MemoryCompactionResult, MemoryContextPressureStatus } from '@chaptale/shared';
import { errorToMessage, parseSkillInvocation } from '@chaptale/shared';

import { evaluateContextPressure } from '../../../modules/memory/context-pressure';
import type { MemoryInjector } from '../../../modules/memory/injector';
import type { PermissionBroker } from '../../../modules/permissions/broker';
import type { BoundSession } from '../../../modules/session-ctx/types';
import type { PiModelService } from '../models/service';
import { flushSessionFile } from '../sessions/file';
import { getPiUserEntrySnapshot } from '../sessions/user-entry-snapshot';
import { AsyncMessageQueue } from './async-message-queue';
import type { ChatSessionFactory } from './chat-session-factory';
import { isChaptaleCompactDetails } from './compact-extension';
import { mapAgentStreamEvent } from './event-mapper';
import type { InputAssembler } from './input-assembler';
import { SessionPool, type DisposableSession } from './session-pool';

type DisposableBoundSession = BoundSession<AgentSession> & DisposableSession;

export type StreamOptions = AgentRunOptions;

export type PiAgentServiceOptions = {
  chatFactory: Pick<ChatSessionFactory, 'create'>;
  modelService: PiModelService;
  memoryInjector: MemoryInjector;
  permissionBroker: PermissionBroker;
  inputAssembler: Pick<InputAssembler, 'assemble'>;
};

/**
 * AgentRuntime 的 Pi 适配边界。
 *
 * 每个 Chaptale 会话对应一个 pi session 文件；上游 AgentSession 只在 integrations 内缓存，
 * 事件与图片在离开该边界前转换为应用协议。
 */
export class PiAgentService implements AgentRuntime {
  private readonly sessions = new SessionPool<DisposableBoundSession>(sessionId => this.createSession(sessionId));

  constructor(private readonly options: PiAgentServiceOptions) {}

  /** 会话目录/工作区切换后调用，丢弃缓存的 AgentSession与记忆注入去重记录。 */
  invalidateSessions() {
    this.sessions.invalidate();
    this.options.memoryInjector.reset();
  }

  private getOrCreateSession(sessionId: string): Promise<BoundSession<AgentSession>> {
    return this.sessions.get(sessionId);
  }

  private async createSession(sessionId: string): Promise<DisposableBoundSession> {
    const bound = await this.options.chatFactory.create(sessionId);
    return { ...bound, dispose: () => bound.session.dispose() };
  }

  async *stream(options: StreamOptions): AsyncGenerator<ChatMessage> {
    const { signal, query, sessionId } = options;
    signal.throwIfAborted();

    const skillInvocation = parseSkillInvocation(query);
    const { session, ctx } = await this.prepareSession(sessionId, Boolean(skillInvocation));
    let abortHandled = false;
    const onAbort = () => {
      if (abortHandled) {
        return;
      }

      abortHandled = true;

      // 中断同时释放该会话挂起的授权请求，避免工具执行阻塞到超时。
      this.options.permissionBroker.rejectSession(sessionId);

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
        : await this.options.memoryInjector.resolvePrefix(sessionId, ctx.cwd);
      const runContext = await this.options.inputAssembler.assemble({
        options,
        skillInvocation,
        reusedContext,
        memoryPrefix
      });
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
    const { session } = await this.getOrCreateSession(options.sessionId);
    options.signal.throwIfAborted();

    if (!session.isStreaming) {
      throw new Error('Agent 运行已结束，无法发送 steer');
    }

    const runContext = await this.options.inputAssembler.assemble({ options, skillInvocation });
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
    const { session } = await this.getOrCreateSession(scope.sessionId);
    scope.signal.throwIfAborted();
    const { steering, followUp } = session.clearQueue();
    return { steering, followUp };
  }

  /** 读取 SDK 的当前上下文估算，并按产品 70% 阈值判断是否提示作者。 */
  async getContextPressure(sessionId: string): Promise<MemoryContextPressureStatus> {
    const { session } = await this.getOrCreateSession(sessionId);
    const usage = session.getSessionStats().contextUsage;

    return evaluateContextPressure(
      usage ?? {
        tokens: null,
        contextWindow: session.model?.contextWindow ?? 0,
        percent: null
      }
    );
  }

  /** 作者主动压缩；检查点生成和 memory 先写由 inline extension 在 pi 落树前完成。 */
  async compactSession(sessionId: string): Promise<MemoryCompactionResult> {
    const { session } = await this.getOrCreateSession(sessionId);

    if (session.isStreaming) {
      throw new Error('运行中不能压缩会话，请等待当前回复完成');
    }

    if (session.isCompacting) {
      throw new Error('会话正在压缩，请勿重复提交');
    }

    const result = await session.compact();
    if (!isChaptaleCompactDetails(result.details)) {
      throw new Error('创作压缩扩展未生效，拒绝接受 native coding 摘要');
    }

    return {
      sessionId,
      tokensBefore: result.tokensBefore,
      ...(result.estimatedTokensAfter !== undefined ? { estimatedTokensAfter: result.estimatedTokensAfter } : {}),
      summaryRef: result.details.summaryRef
    };
  }

  /** 取回（或创建）缓存会话，并保证 skills 定义与默认模型和当前设置一致。 */
  private async prepareSession(sessionId: string, hasSkillInvocation: boolean): Promise<BoundSession<AgentSession>> {
    const bound = await this.getOrCreateSession(sessionId);
    const { session } = bound;

    // 显式 skill 命令应读取磁盘上的最新定义，避免命令菜单已刷新但缓存会话仍持有旧 skills。
    if (hasSkillInvocation) {
      await session.reload();
    }

    // 默认模型可能在会话创建后被切换（或会话恢复了无凭据的旧模型），
    // 每次执行前同步为当前默认模型，避免拿旧模型/旧凭据请求导致 401/403。
    const defaultModel = await this.options.modelService.getDefaultPiModel();

    if (defaultModel && (session.model?.provider !== defaultModel.provider || session.model?.id !== defaultModel.id)) {
      await session.setModel(defaultModel);
    }

    if (!session.model) {
      throw new Error('尚未配置可用模型：请在设置面板 LLM Provider 中配置凭据并选择默认模型');
    }

    return bound;
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
}
