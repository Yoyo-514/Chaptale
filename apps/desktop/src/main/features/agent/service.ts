import type { AgentClearedQueue, AgentRunOptions, AgentRuntime, AgentSteerOptions } from '@chaptale/ipc-contract';
import type { ChatMessage, MemoryCompactionResult, MemoryContextPressureStatus } from '@chaptale/shared';

import { compactSession, type CompactSummarizer } from '../../core/agent/compact';
import { runAgentLoop } from '../../core/agent/engine';
import { AsyncMessageQueue } from '../../core/agent/queue';
import type { PermissionGatePort } from '../../core/agent/types';
import type { ImageAttachmentService } from '../../core/attachments/service';
import type { ContextFileService } from '../../core/context/service';
import type { ResolvedModel } from '../../core/models/runtime';
import type { ModelService } from '../../core/models/service';
import type { SessionStore } from '../../core/sessions/store';
import type { SessionStoreProvider } from '../../core/sessions/store-provider-port';
import { estimateMessagesTokens } from '../../core/sessions/token-estimate';
import { evaluateContextPressure } from '../memory/compaction/pressure';
import { InputAssembler } from './input-assembler';
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
  /**
   * 轻路径：只解析模型。上下文压力与压缩只要 contextWindow，
   * 走 resolve 会白装配全部工具、创建 delegate 工具并读遍 SKILL.md 正文。
   */
  resolveModel: () => Promise<ResolvedModel>;
  resolve: (input: { sessionId: string; cwd: string; personaId?: string }) => Promise<{
    model: ResolvedModel;
    system: string;
    tools: Parameters<typeof runAgentLoop>[0]['tools'];
    /** 按轮绑定会话安全上下文的权限闸门；缺省回落到装配层注入的 options.gate。 */
    gate?: PermissionGatePort;
  }>;
};

export type AgentServiceOptions = {
  sessionRepository: SessionStoreProvider;
  modelService: ModelService;
  runtimeBundle: ChatRuntimeBundle;
  /** 兜底权限闸门；正常由 runtimeBundle 按轮产出（带会话 cwd），此处仅覆盖 bundle 未装配授权的场景。 */
  gate?: PermissionGatePort;
  /** 文件附件解析（文本信封 + 图片进 content，元数据落盘）；缺省不解析。 */
  contextFileService?: Pick<ContextFileService, 'resolve'>;
  /** 图片附件呈现端口（UI 回显缩略图）；缺省回显纯文本。 */
  imageAttachmentService?: Pick<ImageAttachmentService, 'createPresentation'>;
  /**
   * 摘要生产者：装配层注入创作检查点管线（先落检查点，失败即取消压缩）。
   *
   * 必填且无兜底：留降级路径会让接线断掉时无人察觉，而模块内部的单测
   * 一条都不会因此变红。
   */
  compactSummarizer: CompactSummarizer;
  /** 跨会话记忆注入端口（挂 user message 前缀；内容未变化时返回空串）；缺省不注入。 */
  memoryInjector?: { resolvePrefix(sessionId: string, cwd: string): Promise<string> };
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
  private readonly inputAssembler: InputAssembler;

  constructor(private readonly options: AgentServiceOptions) {
    this.inputAssembler = new InputAssembler({
      contextFileService: options.contextFileService,
      imageAttachmentService: options.imageAttachmentService
    });
  }

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
  private async driveRounds(input: {
    sessionId: string;
    store: SessionStore;
    run: ActiveRun;
    signal: AbortSignal;
    options: AgentRunOptions;
    query: string;
    onMessage: (message: ChatMessage) => void;
  }): Promise<void> {
    const { sessionId, store, run, signal, options, query, onMessage } = input;

    // 复用历史条目：切 leaf 到被复用节点；分支重生成：切到目标节点。
    // 两者都不重新组装、不重复落盘 user 消息，也不重发回显（UI 已有该条）。
    if (options.reuseUserEntryId) {
      await store.setLeafId(options.reuseUserEntryId);
    } else {
      if (options.branchFromEntryId) {
        await store.setLeafId(options.branchFromEntryId);
      }

      await this.appendUserRound({
        sessionId,
        store,
        query,
        contextFilePaths: options.contextFilePaths,
        signal,
        onMessage
      });
    }

    let firstRound = true;

    while (!signal.aborted) {
      if (!firstRound) {
        if (run.steering.length === 0) {
          break;
        }

        const steerRequest = run.steering.shift()!;

        // steer 与首轮同构：同一条组装路径，任何形态差异都是 bug。
        await this.appendUserRound({
          sessionId,
          store,
          query: steerRequest.query,
          contextFilePaths: steerRequest.contextFilePaths,
          signal,
          onMessage
        });
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
        // 每轮闸门绑定本会话 cwd（workspace 级规则据此定位 .chaptale/permissions.json）。
        gate: bundle.gate ?? this.options.gate,
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

  /** 组装 → 落盘 → 回显。回显必须在落盘后构造：图片 source 要指向真实 entryId。 */
  private async appendUserRound(input: {
    sessionId: string;
    store: SessionStore;
    query: string;
    contextFilePaths?: string[];
    signal: AbortSignal;
    onMessage: (message: ChatMessage) => void;
  }): Promise<void> {
    const assembled = await this.inputAssembler.assemble({
      sessionId: input.sessionId,
      query: input.query,
      contextFilePaths: input.contextFilePaths,
      memoryPrefix: await this.resolveMemoryPrefix(input.sessionId, input.store.header.cwd),
      signal: input.signal
    });

    const entry = await input.store.appendMessage(assembled.entry);
    input.onMessage(assembled.createEcho(entry.id));
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
    // 只要 contextWindow：走 resolve 会白装配全部工具并读遍 SKILL.md。
    const model = await this.options.runtimeBundle.resolveModel();
    const messages = store.buildContextMessages();

    const contextWindow = model.contextWindow;
    const tokens = estimateMessagesTokens(messages);
    const percent = contextWindow > 0 ? Math.round((tokens / contextWindow) * 100) : null;

    return evaluateContextPressure({ tokens, contextWindow, percent });
  }

  async compactSession(sessionId: string): Promise<MemoryCompactionResult> {
    const run = this.active.get(sessionId);

    if (run?.running) {
      throw new Error('运行中不能压缩会话，请等待当前回复完成');
    }

    const store = await this.options.sessionRepository.open(sessionId);
    const model = await this.options.runtimeBundle.resolveModel();

    const result = await compactSession({ sessionId, model, store, summarize: this.options.compactSummarizer });

    return {
      sessionId,
      tokensBefore: result.tokensBefore,
      estimatedTokensAfter: result.estimatedTokensAfter,
      // 契约要求 summaryRef 必然存在（检查点落盘是压缩前置条件）；
      // 摘要生产者未给出引用时退回正文预览，至少不谎称成一个不存在的路径。
      summaryRef: result.summaryRef ?? result.summary.slice(0, 200)
    };
  }

  /** 设置变更时失效运行时缓存（每轮重读配置，无需动作；保留端口对齐 ipc-registry）。 */
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
