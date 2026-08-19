import type { SessionMessage } from './entry';

/**
 * 工具调用配对：模型上下文的 wire format 不变量。
 *
 * OpenAI/Anthropic 两侧协议都要求 assistant 的每个 tool_call 有且仅有一条配对的
 * tool 结果，且 tool 结果必须有在先的声明。任一侧不成立，provider 会在**发出请求之前**
 * 就拒绝整个上下文（AI SDK 抛 `AI_MissingToolResultsError`）——表现为该会话此后
 * 每次发消息都零 HTTP 请求、无异常、无提示，永久失效。
 *
 * 两个方向都要修，成因不同：
 * - **悬空调用**：运行在工具执行途中被中断（用户点「停止」是最常见路径），
 *   只落了 tool_call 没落结果；
 * - **孤儿结果**：压缩切点落在工具批次中间，声明它的 assistant 被折进摘要，
 *   保留区间以一条无主的 tool 结果开头。
 *
 * 本模块在**读取侧**生效，因此能救活已经写坏的历史会话——纯写入侧的防御做不到这点。
 */

/**
 * 中断补位结果的正文。
 *
 * 措辞把判断交还模型（"未执行，需要就重发"）而不伪造失败原因：中断是用户意图，
 * 模型据此自行决定是否重试，比给它一个假的错误信息更可用。
 */
export const INTERRUPTED_TOOL_RESULT_TEXT = '工具未执行：本次运行已中断。如果仍然需要这一步的结果，请重新发起调用。';

type ToolMessage = Extract<SessionMessage, { role: 'tool' }>;

/** 补齐悬空 tool_call、丢弃孤儿 tool 结果；已配对的序列原样返回。 */
export function repairToolCallPairing(messages: SessionMessage[]): SessionMessage[] {
  const repaired: SessionMessage[] = [];
  /** 已由在先 assistant 声明的调用 id；孤儿判定只认"在先"，不能整体预扫。 */
  const declared = new Set<string>();

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]!;

    if (message.role === 'tool') {
      if (declared.has(message.toolCallId)) {
        repaired.push(message);
      }

      continue;
    }

    repaired.push(message);

    if (message.role !== 'assistant' || !message.toolCalls?.length) {
      continue;
    }

    for (const call of message.toolCalls) {
      declared.add(call.id);
    }

    // 紧随其后的连续 tool 消息即本轮结果区间：一并消费，缺的补在区间末尾。
    const settled = new Set<string>();
    let cursor = index + 1;

    while (cursor < messages.length && messages[cursor]!.role === 'tool') {
      const result = messages[cursor] as ToolMessage;

      if (declared.has(result.toolCallId)) {
        settled.add(result.toolCallId);
        repaired.push(result);
      }

      cursor += 1;
    }

    for (const call of message.toolCalls) {
      if (!settled.has(call.id)) {
        repaired.push({
          role: 'tool',
          toolCallId: call.id,
          toolName: call.name,
          output: INTERRUPTED_TOOL_RESULT_TEXT,
          isError: true
        });
      }
    }

    index = cursor - 1;
  }

  return repaired;
}
