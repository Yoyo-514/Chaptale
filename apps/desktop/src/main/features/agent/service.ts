import type {
  AgentClearedQueue,
  AgentRunOptions,
  AgentRuntime,
  AgentSteerOptions,
  RunEnd,
  StreamAgentHandlers
} from '@chaptale/ipc-contract';
import type { ChatMessage, MemoryCompactionResult, MemoryContextPressureStatus } from '@chaptale/shared';

import type { CompactResult } from '../../core/agent/compact';
import { runAgentLoop } from '../../core/agent/engine';
import { AsyncMessageQueue } from '../../core/agent/queue';
import type { PermissionGatePort } from '../../core/agent/types';
import { decodeContextMessage } from '../../core/context/context-message-codec';
import type { ResolvedModel } from '../../core/models/runtime';
import type { ModelService } from '../../core/models/service';
import type { SessionContentPart, SessionMessage } from '../../core/sessions/entry';
import { evaluateContextPressure } from '../memory/context-pressure';
import type { CoreSessionRepository } from '../sessions/core-repository';
import { createPartTranslator } from './part-translator';

/**
 * 自有 Agent 运行时服务：engine + SessionStore + steer 队列 的编排层。
 *
 * - 事件桥接：fullStream part → AsyncMessageQueue → AsyncGenerator<ChatMessage>
 *   （part-translator 聚合翻译，UI ChatMessage 协议零改动）；
 * - 轮次循环：首轮 query → runAgentLoop → finish 后吸收 steer 队列续跑；abort 即止；
 * - 压缩：core/agent/compact + 装配层检查点钩子。
 */

export type ChatRuntimeBundle = {
  resolve: (input: { sessionId: string; cwd: string; personaId?: string }) => Promise<{
    model: ResolvedModel;
    system: string;
    tools: Parameters<typeof runAgentLoop>[0]['tools'];
  }>;
};

export type AgentServiceOptions = {
  sessionRepository: CoreSessionRepository;
  modelService: ModelService;
  runtimeBundle: ChatRuntimeBundle;
  gate: PermissionGatePort;
  /** 文件附件解析（文本信封 + 图片进 content，元数据落盘）；缺省不解析。 */
  contextFileService?: Pick<import('../../core/context/service').ContextFileService, 'resolve'>;
  /** 图片附件呈现端口（UI 回显缩略图）；缺省回显纯文本。 */
  imageAttachmentService?: Pick<import('../../core/attachments/service').ImageAttachmentService, 'createPresentation'>;
  /** 运行级压缩钩子（检查点与 memory 先写，装配层注入）。 */
  onCompact?: (sessionId: string, result: CompactResult) => Promise<void>;
  /** 跨会话记忆注入端口（挂 user message 前缀；内容未变化时返回空串）；缺省不注入。 */
  memoryInjector?: { resolvePrefix(sessionId: string, cwd: string): Promise<string> };
  /** 压缩提示词（装配层注入）。 */
  compactPrompt: string;
  /** 单轮 step 上限；默认 32。 */
  maxSteps?: number;
};

/** 会话级活跃状态：steer 队列 + 运行中标记。 */
type ActiveRun = {
  steering: Array<{ query: string; contextFilePaths?: string[] }>;
  running: boolean;
};

export class AgentService implements AgentRuntime {
  private readonly active = new Map<string, ActiveRun>();

  constructor(private readonly options: AgentServiceOptions) {}

  async *stream(options: AgentRunOptions): AsyncGenerator<ChatMessage> {
    const { signal, query, sessionId } = options;
    signal.throwIfAborted();

    // 惰性 generator 防：steer 需在首次 next() 前就能登记活跃 run。
    const run = this.ensureRun(sessionId);

    // 同会话并发运行防护：running 中拒绝新 run，避免两条流交错写 JSONL 造成上下文污染。
    if (run.running) {
      throw new Error(`会话正在运行中，无法启动新的运行：${sessionId}`);
    }

    run.steering = [];
    run.running = true;

    const store = await this.options.sessionRepository.openOrCreate(sessionId);

    const queue = new AsyncMessageQueue<ChatMessage>();
    let loopFailure: Error | undefined;

    const loop = this.driveRounds({
      sessionId,
      store,
      run,
      signal,
      options,
      query,
      onMessage: message => queue.push(message)
    })
      .catch(error => {
        loopFailure = error instanceof Error ? error : new Error(String(error));
      })
      .finally(() => queue.finish());

    try {
      // 首条用户消息先于模型响应推送（UI 立即回显）。
      for await (const message of queue.drain()) {
        signal.throwIfAborted();
        yield message;
        signal.throwIfAborted();
      }

      await loop;

      if (loopFailure) {
        throw loopFailure;
      }
    } finally {
      run.running = false;
    }
  }

  /** 轮次驱动：首轮 query，后续吸收 steer；任何一轮异常都不吞（由 stream 统一上抛）。 */
  /** steer 轮附件组装（与首轮同构；无附件时退化为纯文本）。 */
  private async assembleSteerUserMessage(input: {
    query: string;
    contextFilePaths?: string[];
    sessionId: string;
    cwd: string;
    signal: AbortSignal;
  }): Promise<{
    entry: import('../../core/sessions/entry').SessionMessage;
    echo: ChatMessage;
  }> {
    const { query, contextFilePaths, sessionId, cwd, signal } = input;
    const memoryPrefix = await this.resolveMemoryPrefix(sessionId, cwd);

    if (!this.options.contextFileService || !contextFilePaths?.length) {
      return {
        entry: { role: 'user', content: `${memoryPrefix}${query}` },
        echo: { role: 'user', content: query, timestamp: Date.now() }
      };
    }

    const resolved = await this.options.contextFileService.resolve(contextFilePaths, { query, signal });
    const decoded = decodeContextMessage(resolved.promptPrefix);
    const promptText = `${memoryPrefix}${resolved.promptPrefix}${query}`;
    const imageParts = resolved.images.map(image => ({
      type: 'image' as const,
      data: image.data,
      mimeType: image.mimeType
    }));

    const entry: import('../../core/sessions/entry').SessionMessage = {
      role: 'user',
      content: imageParts.length > 0 ? [{ type: 'text', text: promptText }, ...imageParts] : promptText,
      ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {})
    };

    let echo: ChatMessage = {
      role: 'user',
      content: query,
      ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {}),
      timestamp: Date.now()
    };

    if (imageParts.length > 0 && this.options.imageAttachmentService) {
      const presentation = this.options.imageAttachmentService.createPresentation(
        imageParts.map((image, index) => ({
          type: image.type,
          data: image.data,
          mimeType: image.mimeType,
          blockIndex: index + 1
        })),
        blockIndex => ({ type: 'session-entry', sessionId, entryId: '', blockIndex })
      );

      echo = {
        role: 'user',
        content: [{ type: 'text', text: query }, ...presentation.attachments],
        ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {}),
        timestamp: Date.now()
      };
    }

    return { entry, echo };
  }

  private async driveRounds(input: {
    sessionId: string;
    store: import('../../core/sessions/store').SessionStore;
    run: ActiveRun;
    signal: AbortSignal;
    options: AgentRunOptions;
    query: string;
    onMessage: (message: ChatMessage) => void;
  }): Promise<void> {
    const { sessionId, store, run, signal, options, query, onMessage } = input;
    const memoryPrefix = await this.resolveMemoryPrefix(sessionId, store.header.cwd);

    // 首轮附件：文本信封 + 图片进 content（模型回放完整），contextFiles 元数据随行；复用/分支轮不重解析。
    let userEntry: import('../../core/sessions/entry').SessionMessage = {
      role: 'user',
      content: `${memoryPrefix}${query}`
    };
    let echoMessage: ChatMessage = { role: 'user', content: query, timestamp: Date.now() };

    if (this.options.contextFileService && options.contextFilePaths?.length && !options.reuseUserEntryId) {
      const resolved = await this.options.contextFileService.resolve(options.contextFilePaths, {
        query,
        signal
      });
      const decoded = decodeContextMessage(resolved.promptPrefix);
      const promptText = `${memoryPrefix}${resolved.promptPrefix}${query}`;

      if (resolved.images.length > 0) {
        // 图片以 base64 内联进 content（[信封文本, ...images]，模型与回放共用）。
        const imageParts = resolved.images.map(image => ({
          type: 'image' as const,
          data: image.data,
          mimeType: image.mimeType
        }));
        userEntry = {
          role: 'user',
          content: [{ type: 'text', text: promptText }, ...imageParts],
          ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {})
        };

        // UI 回显：图片经附件端口转轻量附件（缩略图 + 原图 source），文本剥信封。
        if (this.options.imageAttachmentService) {
          const presentation = this.options.imageAttachmentService.createPresentation(
            imageParts.map((image, index) => ({
              type: image.type,
              data: image.data,
              mimeType: image.mimeType,
              blockIndex: index + 1
            })),
            blockIndex => ({
              type: 'session-entry',
              sessionId,
              entryId: '',
              blockIndex
            })
          );

          echoMessage = {
            role: 'user',
            content: [{ type: 'text', text: query }, ...presentation.attachments],
            ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {}),
            timestamp: Date.now()
          };
        } else {
          echoMessage = {
            role: 'user',
            content: query,
            ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {}),
            timestamp: Date.now()
          };
        }
      } else {
        userEntry = {
          role: 'user',
          content: promptText,
          ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {})
        };
        echoMessage = {
          role: 'user',
          content: query,
          ...(decoded.contextFiles.length > 0 ? { contextFiles: decoded.contextFiles } : {}),
          timestamp: Date.now()
        };
      }
    }

    // 复用历史条目：切 leaf 到被复用节点；分支重生成：切到目标节点。两者都不重复落盘 user 消息。
    if (options.reuseUserEntryId) {
      await store.setLeafId(options.reuseUserEntryId);
    } else {
      if (options.branchFromEntryId) {
        await store.setLeafId(options.branchFromEntryId);
      }

      await store.appendMessage(userEntry);
    }

    // 复用历史时不重发用户消息回显（UI 已有该条）。
    if (!options.reuseUserEntryId) {
      onMessage(echoMessage);
    }

    let firstRound = true;

    while (!signal.aborted) {
      if (!firstRound) {
        if (run.steering.length === 0) {
          break;
        }

        const steerRequest = run.steering.shift()!;

        // steer 附件与首轮同构：图片内联 content + 元数据落盘 + UI 附件回显。
        const steerEntry = await this.assembleSteerUserMessage({
          query: steerRequest.query,
          contextFilePaths: steerRequest.contextFilePaths,
          sessionId,
          cwd: store.header.cwd,
          signal
        });
        await store.appendMessage(steerEntry.entry);
        onMessage(steerEntry.echo);
      }

      firstRound = false;

      const bundle = await this.options.runtimeBundle.resolve({ sessionId, cwd: store.header.cwd });
      const translator = createPartTranslator(onMessage);

      await runAgentLoop({
        sessionId,
        model: bundle.model,
        system: bundle.system,
        messages: store.buildContextMessages(),
        tools: bundle.tools,
        gate: this.options.gate,
        maxSteps: this.options.maxSteps,
        abortSignal: signal,
        onPart: envelope => translator.consume(envelope.part),
        onStepPersist: async messages => {
          for (const message of messages) {
            await store.appendMessage(message);
          }
        }
      });
    }
  }

  async steer(options: AgentSteerOptions): Promise<void> {
    options.signal.throwIfAborted();
    const run = this.active.get(options.sessionId);

    if (!run || !run.running) {
      throw new Error('Agent 运行已结束，无法发送 steer');
    }

    run.steering.push({ query: options.query, contextFilePaths: options.contextFilePaths });
  }

  async clearPendingMessages(scope: { sessionId: string; signal: AbortSignal }): Promise<AgentClearedQueue> {
    scope.signal.throwIfAborted();
    const run = this.active.get(scope.sessionId);

    if (!run) {
      return { steering: [], followUp: [] };
    }

    const steering = run.steering.map(item => item.query);
    run.steering = [];
    return { steering, followUp: [] };
  }

  async getContextPressure(sessionId: string): Promise<MemoryContextPressureStatus> {
    const store = await this.options.sessionRepository.open(sessionId);
    const bundle = await this.options.runtimeBundle.resolve({ sessionId, cwd: store.header.cwd });
    const messages = store.buildContextMessages();

    const contextWindow = bundle.model.contextWindow;
    const tokens = messages.reduce((total, message) => total + estimateTokens(message), 0);
    const percent = contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : null;

    return evaluateContextPressure({ tokens, contextWindow, percent });
  }

  async compactSession(sessionId: string): Promise<MemoryCompactionResult> {
    const run = this.active.get(sessionId);

    if (run?.running) {
      throw new Error('运行中不能压缩会话，请等待当前回复完成');
    }

    const store = await this.options.sessionRepository.open(sessionId);
    const bundle = await this.options.runtimeBundle.resolve({ sessionId, cwd: store.header.cwd });

    const { compactSession } = await import('../../core/agent/compact');
    const result = await compactSession({ model: bundle.model, store, prompt: this.options.compactPrompt });

    await this.options.onCompact?.(sessionId, result);

    return {
      sessionId,
      tokensBefore: result.tokensBefore,
      summaryRef: result.summary.slice(0, 200)
    };
  }

  /** 供 IPC 层直接消费的流式封装（handlers 回调风格）。 */
  async streamWithHandlers(options: AgentRunOptions, handlers: StreamAgentHandlers): Promise<void> {
    let end: RunEnd;

    try {
      for await (const message of this.stream(options)) {
        handlers.onMessage(message);
      }

      end = { status: options.signal.aborted ? 'cancelled' : 'completed' };
    } catch (error) {
      end = {
        status: 'failed',
        code: 'RUNTIME_ERROR',
        message: (error as Error).message,
        retryable: true
      };
    }

    handlers.onEnd?.(end);
  }

  /** 设置变更时失效运行时缓存（v1：每轮重读配置，无需动作；保留端口对齐 ipc-registry）。 */
  invalidateSessions(): void {
    // 有意留空：runtimeBundle.resolve 每轮重读 models.json 与 persona，天然生效。
  }

  /** run 内按会话 cwd 取记忆注入前缀；未装配注入器时返回空串。 */
  private async resolveMemoryPrefix(sessionId: string, cwd: string): Promise<string> {
    return (await this.options.memoryInjector?.resolvePrefix(sessionId, cwd)) ?? '';
  }

  private ensureRun(sessionId: string): ActiveRun {
    let run = this.active.get(sessionId);

    if (!run) {
      run = { steering: [], running: false };
      this.active.set(sessionId, run);
    }

    return run;
  }
}

/** 图片 token 估算：视觉模型按块计费（约 1–1.5k/图），base64 长度不代表 token 数。 */
const IMAGE_TOKEN_ESTIMATE = 1_500;

function estimateTokens(message: SessionMessage): number {
  switch (message.role) {
    case 'tool':
      return Math.ceil(JSON.stringify(message.output ?? '').length / 2);

    case 'system':
      return Math.ceil(message.content.length / 2);

    default:
      return estimateContentTokens(message.content);
  }
}

/** 文本按字符/2；图片按固定块估算——base64 数据不是 token。 */
function estimateContentTokens(content: string | SessionContentPart[] | undefined): number {
  if (typeof content === 'string') {
    return Math.ceil(content.length / 2);
  }

  if (!content) {
    return 0;
  }

  return content.reduce(
    (total, part) => total + (part.type === 'text' ? Math.ceil(part.text.length / 2) : IMAGE_TOKEN_ESTIMATE),
    0
  );
}
