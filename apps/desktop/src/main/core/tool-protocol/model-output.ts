import type { JSONValue, ToolResultPart } from 'ai';

import { estimateTextTokens, fitTextToTokens } from '../context/token-counter';
import type { ToolResult } from './definition';

/**
 * 工具结果进入模型上下文的 token 预算。
 *
 * 量级取"一章中文正文"：3~5 千字约 3~5k tokens，8k 让 read 一次读完一章、
 * fetch 一次读完一篇网页，超出的中间部分省略、按需分段续读。
 * 模型看到的是截断后的窗口；落盘与 UI 保留 execute 的原始完整返回值。
 */
export const TOOL_RESULT_TOKEN_BUDGET = 8_000;

/**
 * 工具输出 → AI SDK `ToolResultPart['output']` 标签联合（模型通道专用）。
 *
 * 两条模型通道共用本函数，语义必须一致：
 * - 单轮内：SDK 把 execute 返回值经 dynamicTool 的 `toModelOutput` 钩子转成模型消息；
 * - 跨轮回放：落盘消息经 `toModelMessages`（messages.ts）重新投影。
 *
 * 落盘存的是 execute 的原始返回值（UI 与历史导出直接读它渲染，不能包装），
 * 但 provider 侧是 `switch (output.type)` 且没有 default 分支——未打标签的对象
 * 会算出 `content: undefined`，回放时整条工具结果对模型消失。归一化因此不可省。
 *
 * 分支语义：
 * - 项目工具契约 `{ text, details? }`：只取 text——details 是给日志/UI 的结构化
 *   载荷（fetch_content 的 details 里存着整页正文），与 text 一并 json 包装等于
 *   同一内容进两次上下文；
 * - 字符串：直接成文；
 * - 已带合法标签：透传（幂等），text 类补一道预算截断——历史文件可能存着
 *   未截断的超长 text 标签；
 * - 其余对象：json 包装（模型看得到完整结构，工具需自行控制体量）。
 */
export function toModelToolOutput(output: unknown, isError: boolean): ToolResultPart['output'] {
  if (isToolResultShape(output)) {
    return toTextOutput(output.text, isError);
  }

  if (typeof output === 'string') {
    return toTextOutput(output, isError);
  }

  if (isTaggedToolOutput(output)) {
    if (output.type === 'text' || output.type === 'error-text') {
      return { type: output.type, value: fitToolResultText(output.value) };
    }

    return output;
  }

  return { type: isError ? 'error-json' : 'json', value: (output ?? null) as JSONValue };
}

function toTextOutput(text: string, isError: boolean): ToolResultPart['output'] {
  return { type: isError ? 'error-text' : 'text', value: fitToolResultText(text) };
}

/**
 * 超预算时保留首尾并插入省略标记。
 *
 * 首尾比例 25/75：工具输出的首部是触发上下文（读了什么、匹配了什么），
 * 尾部是结论与状态，比首尾各半更有信息量。省略量写进标记让模型能判断
 * 是否值得缩小范围续读。
 */
function fitToolResultText(text: string): string {
  const total = estimateTextTokens(text);

  if (total <= TOOL_RESULT_TOKEN_BUDGET) {
    return text;
  }

  return fitTextToTokens(text, TOOL_RESULT_TOKEN_BUDGET, {
    headRatio: 0.25,
    omitMarker: `\n…（工具输出超出预算，中间省略约 ${total - TOOL_RESULT_TOKEN_BUDGET} tokens）…\n`
  });
}

/**
 * 落盘的工具结果进入模型上下文后占多少 token。
 *
 * 会话 token 估算（`core/sessions/token-estimate.ts`）必须走这里而不是量原始 output：
 * 模型看到的是预算窗口且不含 details，按原文量会把一次大 read 记成几倍于真实占用，
 * 于是压力提示提前报警、压缩保留区间被无谓压缩。口径分叉的代价与低估中文那次同型，
 * 只是方向相反。
 *
 * 直接复用投影函数（而不是另写一套计数分支）是有意的：多切一次字符串换两条通道永不漂移。
 */
export function estimateModelToolOutputTokens(output: unknown, isError: boolean): number {
  const projected = toModelToolOutput(output, isError);

  if (projected.type === 'text' || projected.type === 'error-text') {
    return estimateTextTokens(projected.value);
  }

  return estimateTextTokens(safeStringify(projected));
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value ?? '') ?? '';
  } catch {
    return String(value);
  }
}

/** 项目工具契约（ToolDefinition.execute）的返回形状。 */
function isToolResultShape(output: unknown): output is ToolResult {
  return typeof output === 'object' && output !== null && typeof (output as { text?: unknown }).text === 'string';
}

/** SDK 侧会原样消费的标签；`content` 另需数组 value（SDK 会对它调 .map）。 */
const TOOL_OUTPUT_TAGS = new Set(['text', 'json', 'error-text', 'error-json', 'execution-denied']);

function isTaggedToolOutput(output: unknown): output is ToolResultPart['output'] {
  if (typeof output !== 'object' || output === null || !('type' in output)) {
    return false;
  }

  const tag = (output as { type: unknown }).type;

  if (typeof tag !== 'string') {
    return false;
  }

  // 形状不合法的 content 不能放行：SDK 会对 value 调 .map()，非数组直接崩。
  // 退回 json 包装是安全的降级——模型仍看得到全部内容。
  if (tag === 'content') {
    return Array.isArray((output as { value?: unknown }).value);
  }

  return TOOL_OUTPUT_TAGS.has(tag);
}
