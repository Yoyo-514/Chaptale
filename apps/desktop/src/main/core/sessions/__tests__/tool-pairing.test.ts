import { describe, expect, it } from 'vitest';

import type { SessionMessage } from '../entry';
import { INTERRUPTED_TOOL_RESULT_TEXT, repairToolCallPairing } from '../tool-pairing';

/**
 * 工具配对不变量。
 *
 * 这一层的存在理由是**读取侧能救活已经写坏的历史会话**：悬空 tool_call 会让
 * provider 在发出请求之前拒绝整个上下文，表现为该会话此后永久静默失效。
 */

const assistantWithCalls = (...calls: { id: string; name: string }[]): SessionMessage => ({
  role: 'assistant',
  content: '这就去查。',
  toolCalls: calls.map(call => ({ id: call.id, name: call.name, arguments: {} }))
});

const toolResult = (toolCallId: string, toolName: string, output: unknown = { text: 'ok' }): SessionMessage => ({
  role: 'tool',
  toolCallId,
  toolName,
  output
});

describe('repairToolCallPairing', () => {
  it('已配对的序列原样返回（不制造多余消息）', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: '读一下第三章' },
      assistantWithCalls({ id: 'call_1', name: 'read' }),
      toolResult('call_1', 'read'),
      { role: 'assistant', content: '读完了。' }
    ];

    expect(repairToolCallPairing(messages)).toEqual(messages);
  });

  it('悬空 tool_call：补合成结果，正文把判断交还模型', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: '写第三章' },
      assistantWithCalls({ id: 'call_1', name: 'write' })
    ];

    const repaired = repairToolCallPairing(messages);

    expect(repaired).toHaveLength(3);
    expect(repaired[2]).toEqual({
      role: 'tool',
      toolCallId: 'call_1',
      toolName: 'write',
      output: INTERRUPTED_TOOL_RESULT_TEXT,
      isError: true
    });
  });

  it('半批：只补缺的那个，已有结果保持原位与原内容', () => {
    const messages: SessionMessage[] = [
      assistantWithCalls({ id: 'call_1', name: 'write' }, { id: 'call_2', name: 'write' }),
      toolResult('call_1', 'write', { text: '已写入 第一章.md' })
    ];

    const repaired = repairToolCallPairing(messages);

    expect(repaired.map(message => message.role)).toEqual(['assistant', 'tool', 'tool']);
    expect(repaired[1]).toMatchObject({ toolCallId: 'call_1', output: { text: '已写入 第一章.md' } });
    expect(repaired[2]).toMatchObject({ toolCallId: 'call_2', isError: true });
  });

  it('孤儿 tool 结果被丢弃：压缩切点切在工具批次中间时会成批出现', () => {
    const messages: SessionMessage[] = [
      // 声明它的 assistant 已被折进摘要，保留区间以无主结果开头。
      { role: 'user', content: '（压缩摘要）' },
      toolResult('call_orphan', 'read'),
      { role: 'assistant', content: '继续。' }
    ];

    expect(repairToolCallPairing(messages).map(message => message.role)).toEqual(['user', 'assistant']);
  });

  it('多轮工具链：各轮独立配对，不跨轮借用结果', () => {
    const messages: SessionMessage[] = [
      assistantWithCalls({ id: 'call_1', name: 'read' }),
      toolResult('call_1', 'read'),
      assistantWithCalls({ id: 'call_2', name: 'write' })
    ];

    const repaired = repairToolCallPairing(messages);

    expect(repaired.map(message => message.role)).toEqual(['assistant', 'tool', 'assistant', 'tool']);
    expect(repaired[3]).toMatchObject({ toolCallId: 'call_2', isError: true });
  });

  it('无工具调用的普通对话不受影响', () => {
    const messages: SessionMessage[] = [
      { role: 'user', content: '你好' },
      { role: 'assistant', content: '你好，需要我做什么？' }
    ];

    expect(repairToolCallPairing(messages)).toEqual(messages);
  });
});
