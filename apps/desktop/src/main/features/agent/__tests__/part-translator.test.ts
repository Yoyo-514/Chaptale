import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@chaptale/shared';

import { createPartTranslator } from '../part-translator';

function collect(parts: unknown[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  const translator = createPartTranslator(message => messages.push(message));

  for (const part of parts) {
    translator.consume(part);
  }

  return messages;
}

function assistantAt(messages: ChatMessage[], index: number) {
  const message = messages[index];

  if (message?.role !== 'assistant') {
    throw new Error(`messages[${index}] 不是 assistant：${message?.role}`);
  }

  return message;
}

describe('part-translator 流式投影', () => {
  it('text-delta 逐条推送增量 partial，finish-step 以全量定稿', () => {
    const messages = collect([
      { type: 'text-delta', text: '你' },
      { type: 'text-delta', text: '好' },
      { type: 'finish-step', usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 } }
    ]);

    // UI 的 pushText 是追加语义：前两条必须是 delta 而非累计快照，否则渲染成「你你好」。
    expect(messages).toHaveLength(3);
    expect(assistantAt(messages, 0)).toMatchObject({ content: '你', partial: true });
    expect(assistantAt(messages, 1)).toMatchObject({ content: '好', partial: true });
    expect(assistantAt(messages, 2)).toMatchObject({
      content: '你好',
      partial: false,
      usage: { inputTokens: 3, outputTokens: 5, totalTokens: 8 }
    });
  });

  it('空 delta 不产生消息', () => {
    expect(collect([{ type: 'text-delta', text: '' }])).toEqual([]);
  });

  it('reasoning-delta 推送累计快照（UI 侧覆盖语义）', () => {
    const messages = collect([
      { type: 'reasoning-delta', text: '先' },
      { type: 'reasoning-delta', text: '想想' }
    ]);

    expect(assistantAt(messages, 0)).toMatchObject({ reasoning: '先', content: '', partial: true });
    expect(assistantAt(messages, 1)).toMatchObject({ reasoning: '先想想', content: '', partial: true });
  });

  it('tool-call 在工具执行前就推送卡片，且只带本次调用', () => {
    const messages = collect([
      { type: 'text-delta', text: '这就去查' },
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: { path: 'a.md' } },
      { type: 'tool-call', toolCallId: 'call-2', toolName: 'grep', input: { pattern: 'x' } }
    ]);

    // 第二条 tool-call 只带 call-2：UI 按调用 ID 幂等更新，带全量会把 call-1 重复渲染一次。
    expect(assistantAt(messages, 1)).toMatchObject({
      partial: true,
      toolCalls: [{ id: 'call-1', name: 'read', arguments: { path: 'a.md' } }]
    });
    expect(assistantAt(messages, 2)).toMatchObject({
      partial: true,
      toolCalls: [{ id: 'call-2', name: 'grep', arguments: { pattern: 'x' } }]
    });
  });

  it('tool-result 只推送结果，assistant 定稿留给 finish-step 以带上 usage', () => {
    const messages = collect([
      { type: 'tool-call', toolCallId: 'call-1', toolName: 'read', input: {} },
      { type: 'tool-result', toolCallId: 'call-1', toolName: 'read', output: '内容' },
      { type: 'finish-step', usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 } }
    ]);

    expect(messages[1]).toMatchObject({ role: 'tool', toolCallId: 'call-1', output: '内容' });
    expect(assistantAt(messages, 2)).toMatchObject({
      partial: false,
      toolCalls: [{ id: 'call-1', name: 'read' }],
      usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 }
    });
  });

  it('无载荷的 step 不把 usage 泄漏到下一条定稿消息', () => {
    const messages = collect([
      { type: 'finish-step', usage: { inputTokens: 9, outputTokens: 9, totalTokens: 18 } },
      { type: 'text-delta', text: '答' },
      { type: 'finish-step', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 } }
    ]);

    expect(assistantAt(messages, 1)).toMatchObject({
      content: '答',
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }
    });
  });
});
