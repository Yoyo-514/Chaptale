import { describe, expect, it } from 'vitest';

import type { ChatMessage } from '@chaptale/shared';

import { useAssistantStreamingMessages } from '../../composables/useAssistantStreamingMessages';
import type { ChatDisplayMessage } from '../../types';

function createHarness() {
  const messages: ChatDisplayMessage[] = [];
  let sequence = 0;
  const streaming = useAssistantStreamingMessages({
    getMessages: () => messages,
    createDisplayMessage(message: ChatMessage, prefix = 'message') {
      sequence += 1;
      return { id: `${prefix}-${sequence}`, message };
    }
  });

  return { messages, streaming };
}

function toolCall(id: string, args: Record<string, unknown> = { path: 'a.ts' }): ChatMessage {
  return {
    role: 'assistant',
    content: '',
    toolCalls: [{ id, name: 'edit', arguments: args }],
    stopReason: 'toolUse'
  };
}

function toolResult(id: string, text: string): ChatMessage {
  return {
    role: 'tool',
    toolCallId: id,
    toolName: 'edit',
    output: text
  };
}

describe('useAssistantStreamingMessages tool lifecycle', () => {
  it('preserves streamed assistant text when the tool call starts', () => {
    const { messages, streaming } = createHarness();

    streaming.pushText('先修改文件。');
    streaming.flush();
    const displayId = messages[0]?.id;
    streaming.appendOrReplaceAssistantMessage(toolCall('call-1'));

    expect(messages).toHaveLength(1);
    expect(messages[0]?.id).toBe(displayId);
    expect(messages[0]?.message).toMatchObject({
      role: 'assistant',
      content: '先修改文件。',
      toolCalls: [{ id: 'call-1', name: 'edit', arguments: { path: 'a.ts' } }]
    });
  });

  it('updates repeated tool starts and results in place by tool call id', () => {
    const { messages, streaming } = createHarness();

    streaming.appendOrReplaceAssistantMessage(toolCall('call-1'));
    streaming.appendOrReplaceAssistantMessage(toolCall('call-1', { path: 'b.ts' }));
    streaming.appendOrReplaceAssistantMessage(toolResult('call-1', 'first'));
    const resultDisplayId = messages[1]?.id;
    streaming.appendOrReplaceAssistantMessage(toolResult('call-1', 'final'));

    expect(messages).toHaveLength(2);
    expect(messages[0]?.message).toMatchObject({
      role: 'assistant',
      toolCalls: [{ id: 'call-1', arguments: { path: 'b.ts' } }]
    });
    expect(messages[1]?.id).toBe(resultDisplayId);
    expect(messages[1]?.message).toMatchObject({
      role: 'tool',
      toolCallId: 'call-1',
      output: 'final'
    });
  });

  it('keeps parallel calls and out-of-order results as distinct messages', () => {
    const { messages, streaming } = createHarness();

    streaming.appendOrReplaceAssistantMessage(toolCall('call-1', { path: 'a.ts' }));
    streaming.appendOrReplaceAssistantMessage(toolCall('call-2', { path: 'b.ts' }));
    streaming.appendOrReplaceAssistantMessage(toolResult('call-2', 'b done'));
    streaming.appendOrReplaceAssistantMessage(toolResult('call-1', 'a done'));

    expect(messages).toHaveLength(4);
    expect(messages.map(item => (item.message.role === 'tool' ? item.message.toolCallId : 'call'))).toEqual([
      'call',
      'call',
      'call-2',
      'call-1'
    ]);
  });
});
