import { stepCountIs, streamText } from 'ai';
import type { ModelMessage } from 'ai';

import { errorToMessage } from '@chaptale/shared';

import type { ResolvedModel } from '../models/runtime';
import type { SessionMessage } from '../sessions/entry';
import { INTERRUPTED_TOOL_RESULT_TEXT } from '../sessions/tool-pairing';
import { stepRecordsToSessionMessages, toModelMessages } from './messages';
import { toAiSdkTools } from './tools';
import type { AgentStreamEnvelope, PermissionGatePort, ToolResultRecord } from './types';

export type RunAgentLoopOptions = {
  sessionId: string;
  model: ResolvedModel;
  /** 系统提示词（composeSystemPrompt 产物，装配层注入）。 */
  system: string;
  /** 回放产物（store.buildContextMessages()）。 */
  messages: SessionMessage[];
  tools: Parameters<typeof toAiSdkTools>[0];
  gate?: PermissionGatePort;
  /** step 边界落盘回调；缺省不落盘（测试用）。 */
  onStepPersist?: (messages: SessionMessage[]) => Promise<void>;
  /** 事件透传回调（IPC 信封已在调用方组装或此处直传 part）。 */
  onPart?: (envelope: AgentStreamEnvelope) => void;
  abortSignal?: AbortSignal;
  /** step 上限；正常由无 tool call 自然停止，此值是失控护栏。 */
  maxSteps?: number;
  /** run 级累计 token 预算；超出即停（成本护栏）。 */
  maxTotalTokens?: number;
  /**
   * 截断批次整体作废后，允许模型在同一 run 内重发的次数。
   *
   * 作废时模型已经拿到"请拆小后重发"的理由，多数情况下它自己就能改对；
   * 让作者再说一句"继续"是把引擎的问题推给人。次数必须有限——
   * 模型可能一再产出超长输出，那就不是重试能解决的了。
   */
  maxTruncationRetries?: number;
  /**
   * 相邻两个 chunk 之间允许的最长静默；超过即以超时失败收尾。
   *
   * 计的是间隔而不是整轮时长：后者会误杀长输出，而真正要防的是另一回事——
   * provider 接下了连接却再不吐字节。那种情况下流既不结束也不报错，
   * 作者除了手动取消没有任何出路。
   */
  idleTimeoutMs?: number;
  /**
   * 每步开始前的干预点。
   *
   * 这是把循环收回引擎换来的东西：SDK 自驱多步时不存在这样一个
   * 「上一步已结算、下一步未发出」的时点。三类用途共用它——
   * 注入作者中途的插话、按步改配置、推翻引擎的停止决定。
   *
   * 只在 step 边界调用是硬约束：工具执行途中注入消息会写出悬空 tool_call。
   */
  prepareStep?: (context: PrepareStepContext) => Promise<PrepareStepResult | undefined>;
};

export type PrepareStepContext = {
  /** 即将执行的步序号（0 起）。 */
  stepIndex: number;
  /** 若不干预，引擎将以此原因停止；undefined 表示本来就要继续。 */
  pendingStop?: AgentStopReason;
  /** 截至目前的累计 usage。 */
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
};

export type PrepareStepResult = {
  /**
   * 追加进本 run 会话的消息（作者中途插话走这里）。
   *
   * 落盘与 UI 回显由调用方负责：引擎不认识 SessionStore，
   * 而这条消息必须与落盘的是同一条，否则重开会话时上下文对不上。
   */
  appendMessages?: SessionMessage[];
  /** 覆盖本步模型；缺省沿用 run 级配置。 */
  model?: ResolvedModel;
  /** 覆盖本步系统提示词；缺省沿用 run 级配置。 */
  system?: string;
  /** 覆盖本步工具集；缺省沿用 run 级配置。 */
  tools?: Parameters<typeof toAiSdkTools>[0];
  /** 即使引擎打算停止也继续跑；仅在 pendingStop 存在时有意义。 */
  resume?: boolean;
};

/** 默认 step 上限：正常创作轮远用不到 32 步，此值是失控护栏。 */
const DEFAULT_MAX_STEPS = 32;

/**
 * 默认 run 级 token 预算：约等于一次满上下文窗口的完整单轮。
 * 正常创作轮在几万 tokens 量级，预算触发意味着工具链接近失控。
 */
const DEFAULT_MAX_TOTAL_TOKENS = 200_000;

/** 截断作废后的默认重发次数：给模型一次自纠机会，不给第二次。 */
const DEFAULT_MAX_TRUNCATION_RETRIES = 1;

/**
 * 默认流级空闲超时。
 *
 * 三分钟是给「思考期完全静默」的模型留的余量——这类模型不流式吐 reasoning，
 * 首字节可能要等上一两分钟，按更短的间隔计时会把正在思考的模型砍掉。
 * 宁可让作者多等，也不能误杀；而与「永远转圈」相比，三分钟已经是有限的等待。
 */
const DEFAULT_IDLE_TIMEOUT_MS = 180_000;

/** 空闲超时哨兵：用独有 symbol 而不是 null/undefined，避免与流上的合法值撞上。 */
const IDLE_TIMEOUT = Symbol('idle-timeout');

/**
 * 循环停止原因。
 *
 * 只有 `natural` 是模型自己收的尾；其余四种都是引擎替它做的决定，
 * 调用方据此决定要不要向作者解释"为什么停在这里"。
 */
export type AgentStopReason =
  /** 模型本步没有再调用工具。 */
  | 'natural'
  /** 达到 step 上限。 */
  | 'step-limit'
  /** 达到 run 级 token 预算。 */
  | 'token-budget'
  /** 模型输出撞上 token 上限，同批工具调用已整体作废。 */
  | 'output-truncated'
  /** 用户取消。 */
  | 'aborted';

export type AgentLoopResult = {
  /** 最后一次模型调用的原始停止原因。 */
  finishReason: string;
  totalUsage: { inputTokens: number; outputTokens: number; totalTokens: number };
  aborted: boolean;
  /** 循环为何停止；护栏截停与自然收尾在此可分辨。 */
  stopReason: AgentStopReason;
  /** 实际执行的 step 数。 */
  steps: number;
};

/**
 * Agent 主循环：**引擎驱动逐步循环**，每步一次 `streamText`。
 *
 * SDK 的 `stopWhen` 固定为单步：它只负责"一次模型调用 + 本批工具执行"，
 * 要不要走下一步由引擎判断。这个所有权划分换来的是一个原本不存在的时点——
 * 「上一步已结算、下一步未发出」。按步换模型、作者中途插话、截断后自纠重发，
 * 全都落在这个时点上（见 `prepareStep`）；停因也因此可辨认，
 * 护栏截停不再是"安静地停"。代价只有每步重建一次 ToolSet。
 *
 * 会话推进用 `result.responseMessages`（SDK 自己生成的模型消息）而**不是**落盘投影：
 * 落盘形态有意丢弃 reasoning（它不进回放），而带思维链的模型在工具轮里
 * 需要原样回传 reasoning 分块与 provider 签名，改用投影会让这类模型直接被拒。
 * 落盘仍走 `stepRecordsToSessionMessages`，两条路径各司其职。
 *
 * 事件透传：fullStream part → onPart 原样转发（{sessionId, seq, part} 信封），
 * seq 跨 step 连续；落盘：每步结束把 assistant + tool 结果交 onStepPersist
 * （收集器自聚合，不依赖 SDK 内部聚合时序），崩溃丢失上限 = 当前 step。
 *
 * **错误即值**：AI SDK 不抛异常，失败以 `error` / `tool-error` 两类 part 出现。
 * 两者都必须有分支——漏掉 `tool-error` 会落盘出没有配对结果的 tool_call，
 * 该会话此后每次请求都被 `AI_MissingToolResultsError` 挡在网络层之前；
 * 漏掉 `error` 则 provider 故障（401/429/500/断网）被静默吞掉、运行报告成功。
 *
 * **截断即作废**：模型输出撞 token 上限时整批工具调用一个都不执行（见 tools.ts），
 * 随后给模型有限次数的重发机会。
 */
export async function runAgentLoop(options: RunAgentLoopOptions): Promise<AgentLoopResult> {
  const {
    sessionId,
    model,
    system,
    messages,
    tools,
    gate,
    onStepPersist,
    onPart,
    abortSignal,
    maxSteps = DEFAULT_MAX_STEPS,
    maxTotalTokens = DEFAULT_MAX_TOTAL_TOKENS,
    maxTruncationRetries = DEFAULT_MAX_TRUNCATION_RETRIES,
    idleTimeoutMs = DEFAULT_IDLE_TIMEOUT_MS,
    prepareStep
  } = options;

  /** 本 run 的模型侧会话；每步追加 SDK 的响应消息后再发下一步。 */
  const conversation: ModelMessage[] = toModelMessages(messages);

  let seq = 0;
  let steps = 0;
  let aborted = false;
  let finishReason = 'unknown';
  let truncationRetries = 0;
  const totalUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

  /**
   * 引擎「若不干预就会以此停止」的倾向。
   *
   * 决定有意推迟到下一轮迭代的开头才执行：prepareStep 必须先有机会看到它、
   * 并可能推翻它（作者中途插话就是这种情况——模型本已收尾，但话没说完）。
   */
  let pendingStop: AgentStopReason | undefined;
  let stopReason: AgentStopReason | undefined;

  let stepModel = model;
  let stepSystem = system;
  let stepTools = tools;

  for (let index = 0; index < maxSteps; index += 1) {
    if (abortSignal?.aborted) {
      aborted = true;
      stopReason = 'aborted';
      break;
    }

    const plan = await prepareStep?.({
      stepIndex: index,
      ...(pendingStop ? { pendingStop } : {}),
      totalUsage: { ...totalUsage }
    });

    if (pendingStop !== undefined && plan?.resume !== true) {
      stopReason = pendingStop;
      break;
    }

    if (plan?.appendMessages?.length) {
      conversation.push(...toModelMessages(plan.appendMessages));
    }

    stepModel = plan?.model ?? stepModel;
    stepSystem = plan?.system ?? stepSystem;
    stepTools = plan?.tools ?? stepTools;
    pendingStop = undefined;

    steps += 1;
    const step = await runStep();

    finishReason = step.finishReason;
    totalUsage.inputTokens += step.usage.inputTokens;
    totalUsage.outputTokens += step.usage.outputTokens;
    totalUsage.totalTokens += step.usage.totalTokens;

    // 落盘先于一切判断：中断与 provider 故障都要留下已收集的内容。
    await persistStep(step);

    if (step.aborted) {
      aborted = true;
      stopReason = 'aborted';
      break;
    }

    // 取消是用户意图，不算失败；其余 error part 必须以异常抵达调用方，
    // 否则 IPC 会发出 { status: 'completed' } 而界面上什么都没有。
    if (step.error !== undefined) {
      throw step.error instanceof Error ? step.error : new Error(errorToMessage(step.error));
    }

    conversation.push(...step.responseMessages);

    if (step.finishReason === 'length' && truncationRetries < maxTruncationRetries) {
      // 整批已作废，模型手上已有"请拆小后重发"的理由；给它一次自纠的机会，
      // 而不是让作者再说一句"继续"。
      truncationRetries += 1;
    } else if (step.finishReason === 'length') {
      pendingStop = 'output-truncated';
    } else if (step.toolCalls.length === 0) {
      pendingStop = 'natural';
    } else if (totalUsage.totalTokens >= maxTotalTokens) {
      pendingStop = 'token-budget';
    }
  }

  return { finishReason, totalUsage, aborted, stopReason: stopReason ?? pendingStop ?? 'step-limit', steps };

  /** 单步：一次模型调用 + 本批工具执行，SDK 结束后把控制权交还引擎。 */
  async function runStep(): Promise<StepOutcome> {
    let text = '';
    let reasoning = '';
    const toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[] = [];
    const toolResults: ToolResultRecord[] = [];
    let usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };
    let outputTruncated = false;
    // 取模型调用自身的停止原因，而不是流上的聚合值：同一次截断在聚合值里是 'other'，
    // 认不出来（这正是"整批作废"的判定依据，两者必须同源）。
    let stepFinishReason = 'unknown';
    let stepAborted = false;
    let streamError: unknown;

    const result = streamText({
      model: stepModel.model,
      system: stepSystem,
      messages: conversation,
      tools: toAiSdkTools(stepTools, { sessionId, gate, isOutputTruncated: () => outputTruncated }),
      // 单步：多步循环归引擎，SDK 不自行续跑。
      stopWhen: stepCountIs(1),
      abortSignal,
      // 模型响应解析完毕、任何工具执行开始前触发。SDK 把整批工具推迟到 model-call-end
      // 才一起执行，而该回调正好在其之前——这是唯一还来得及拦下截断批次的时点，
      // fullStream 的 finish part 到达时工具早已跑完。
      onLanguageModelCallEnd: event => {
        outputTruncated = event.finishReason === 'length';
        stepFinishReason = event.finishReason;
      },
      // 模型级参数：未配置时不传，交由服务端默认（temperature/topP 仅 OpenAI 兼容系生效，其余协议忽略）。
      ...(stepModel.maxTokens !== undefined ? { maxOutputTokens: stepModel.maxTokens } : {}),
      ...(stepModel.temperature !== undefined ? { temperature: stepModel.temperature } : {}),
      ...(stepModel.topP !== undefined ? { topP: stepModel.topP } : {})
    });

    try {
      for await (const part of withIdleTimeout(result.fullStream, idleTimeoutMs)) {
        if (part === IDLE_TIMEOUT) {
          // 与 provider 故障走同一条路：先跳出去把已收到的内容落盘，再由调用方感知失败。
          // 文案里的 "timeout" 是留给 classifyProviderFault 的正则认的，改措辞时别弄丢。
          streamError = new Error(
            `模型接了连接但 ${Math.round(idleTimeoutMs / 1000)} 秒内没有再返回内容（stream idle timeout）`
          );
          break;
        }

        onPart?.({ sessionId, seq: seq++, part });

        if (part.type === 'text-delta') {
          text += part.text;
        } else if (part.type === 'reasoning-delta') {
          // fullStream 的 TextStreamReasoningDeltaPart 属性是 text（UIMessage chunk 才是 delta）。
          reasoning += part.text;
        } else if (part.type === 'tool-call') {
          toolCalls.push({
            id: part.toolCallId,
            name: part.toolName,
            arguments: (part.input ?? {}) as Record<string, unknown>
          });
        } else if (part.type === 'tool-result') {
          toolResults.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: part.output,
            // 保留 SDK 的失败标记（该字段在结果 part 上可缺省）。
            isError: 'isError' in part ? part.isError === true : false
          });
        } else if (part.type === 'tool-error') {
          // 与 tool-result 同等落盘：工具失败也是一条结果，缺了它 tool_call 就悬空。
          // 触发面比"工具自己抛错"宽——模型调用不存在的工具、参数 JSON 被 token
          // 上限截断导致 SDK 拒绝执行，走的都是这条。
          toolResults.push({
            toolCallId: part.toolCallId,
            toolName: part.toolName,
            output: `工具执行失败：${errorToMessage(part.error)}`,
            isError: true
          });
        } else if (part.type === 'error') {
          // provider 故障（401/429/500/断网）与 SDK 前置校验失败都走这里。
          // 不能就地抛：先跳出循环把已收集内容落盘，再由调用方感知失败。
          streamError = part.error;
        } else if (part.type === 'finish-step') {
          usage = normalizeUsage(part.usage);
        } else if (part.type === 'abort') {
          stepAborted = true;
        }
      }
    } catch (error) {
      if (!abortSignal?.aborted) {
        throw error;
      }

      stepAborted = true;
    }

    return {
      text,
      reasoning,
      toolCalls,
      toolResults,
      usage,
      finishReason: stepFinishReason,
      aborted: stepAborted,
      error: streamError,
      // 失败与中断的响应消息不进会话：半截 step 不该参与下一步的上下文，
      // 而这两种情况下循环都会立即结束。
      responseMessages: streamError === undefined && !stepAborted ? await result.responseMessages : []
    };
  }

  async function persistStep(step: StepOutcome): Promise<void> {
    if (!onStepPersist) {
      return;
    }

    if (!step.text && !step.reasoning && step.toolCalls.length === 0 && step.toolResults.length === 0) {
      return;
    }

    await onStepPersist(
      stepRecordsToSessionMessages(
        {
          text: step.text,
          ...(step.reasoning ? { reasoning: step.reasoning } : {}),
          toolCalls: step.toolCalls,
          usage: step.usage
        },
        withSyntheticResults(step.toolCalls, step.toolResults)
      )
    );
  }
}

type StepOutcome = {
  text: string;
  reasoning: string;
  toolCalls: { id: string; name: string; arguments: Record<string, unknown> }[];
  toolResults: ToolResultRecord[];
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
  finishReason: string;
  aborted: boolean;
  error: unknown;
  responseMessages: ModelMessage[];
};

/**
 * 为没有结果的 tool call 补合成结果。
 *
 * 正常 step 里 SDK 保证流结束前所有工具已结算，此函数是恒等的；
 * 真正生效的是中断路径：用户在工具执行途中点「停止」时流里只有 tool-call、
 * 没有 tool-result，而引擎仍会尽力落盘——不补就写出悬空 tool_call。
 *
 * 写入侧与读取侧（`core/sessions/tool-pairing.ts`）两道都要有：读取侧能救活
 * 已经写坏的历史，写入侧保证文件本身自洽——历史面板与 HTML 导出直接读 entry，
 * 不经上下文投影。
 */
export function withSyntheticResults(
  toolCalls: { id: string; name: string }[],
  results: ToolResultRecord[]
): ToolResultRecord[] {
  if (toolCalls.length === 0) {
    return results;
  }

  const settled = new Set(results.map(result => result.toolCallId));
  const synthetic = toolCalls
    .filter(call => !settled.has(call.id))
    .map((call): ToolResultRecord => ({
      toolCallId: call.id,
      toolName: call.name,
      output: INTERRUPTED_TOOL_RESULT_TEXT,
      isError: true,
      interrupted: true
    }));

  return synthetic.length > 0 ? [...results, ...synthetic] : results;
}

/**
 * 给异步流套上空闲超时：相邻两次产出之间静默超过 `timeoutMs`，就交出哨兵再收尾。
 *
 * 做成包装 generator 而不是在消费端手写迭代，为的是让清理自动串联——
 * 消费端 `break` 会调用本 generator 的 `return`，`finally` 随即关掉源迭代器。
 * 少了这一步，超时之后底层连接仍挂在那里，而它正是超时想摆脱的东西。
 */
async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  timeoutMs: number
): AsyncGenerator<T | typeof IDLE_TIMEOUT> {
  const iterator = source[Symbol.asyncIterator]();

  try {
    let next = await raceIdleTimeout(iterator.next(), timeoutMs);

    while (next !== IDLE_TIMEOUT && next.done !== true) {
      yield next.value;
      next = await raceIdleTimeout(iterator.next(), timeoutMs);
    }

    if (next === IDLE_TIMEOUT) {
      yield IDLE_TIMEOUT;
    }
  } finally {
    // 不等它完成是刻意的：收尾若自己也挂住，就把刚诊断出的静默又拖成一次挂起。
    void iterator.return?.().catch(() => undefined);
  }
}

/**
 * 等下一次产出，静默超过 `timeoutMs` 则以哨兵返回。
 *
 * 定时器随每次产出重建：空闲计时要的就是「自上一个 chunk 起」，
 * 一个长驻定时器量出来的是整轮时长，那会误杀长输出。
 */
function raceIdleTimeout<T>(next: Promise<T>, timeoutMs: number): Promise<T | typeof IDLE_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;

  return Promise.race([
    next,
    new Promise<typeof IDLE_TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(IDLE_TIMEOUT), timeoutMs);
    })
  ]).finally(() => {
    clearTimeout(timer);
  });
}

function normalizeUsage(usage: { inputTokens?: number; outputTokens?: number; totalTokens?: number }) {
  return {
    inputTokens: usage.inputTokens ?? 0,
    outputTokens: usage.outputTokens ?? 0,
    totalTokens: usage.totalTokens ?? 0
  };
}
