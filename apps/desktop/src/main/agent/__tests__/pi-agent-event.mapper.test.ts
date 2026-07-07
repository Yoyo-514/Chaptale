import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { describe, expect, it } from 'vitest';

import { mapAgentStreamEvent } from '../pi-agent-event.mapper';

function mapEvent(event: unknown, aborted = false) {
  return mapAgentStreamEvent(event as AgentSessionEvent, { aborted });
}

describe('mapAgentStreamEvent', () => {
  it('maps text deltas to partial assistant messages', () => {
    const mapping = mapEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'text_delta', delta: '你好' }
    });

    expect(mapping.done).toBeUndefined();
    expect(mapping.message).toMatchObject({
      role: 'assistant',
      partial: true,
      content: [{ type: 'text', text: '你好' }]
    });
  });

  it('maps thinking lifecycle to reasoning messages', () => {
    const started = mapEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
    const delta = mapEvent({
      type: 'message_update',
      assistantMessageEvent: { type: 'thinking_delta', delta: '思考中' }
    });
    const ended = mapEvent({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } });

    expect(started.message).toMatchObject({ role: 'assistant', partial: true, content: [] });
    expect(delta.message).toMatchObject({
      role: 'assistant',
      partial: true,
      content: [{ type: 'thinking', thinking: '思考中' }]
    });
    expect(ended.message).toMatchObject({ role: 'assistant', partial: false, content: [] });
  });

  it('maps tool execution events', () => {
    const started = mapEvent({
      type: 'tool_execution_start',
      toolCallId: 'call-1',
      toolName: 'websearch',
      args: { query: 'x' }
    });
    const ended = mapEvent({
      type: 'tool_execution_end',
      toolCallId: 'call-1',
      toolName: 'websearch',
      result: { content: [{ type: 'text', text: 'result text' }] }
    });

    expect(started.message).toMatchObject({
      role: 'assistant',
      stopReason: 'toolUse',
      content: [{ type: 'toolCall', id: 'call-1', name: 'websearch', arguments: { query: 'x' } }]
    });
    expect(ended.message).toMatchObject({
      role: 'toolResult',
      toolCallId: 'call-1',
      toolName: 'websearch',
      content: [{ type: 'text', text: 'result text' }]
    });
  });

  it('maps retry events', () => {
    const retrying = mapEvent({
      type: 'auto_retry_start',
      errorMessage: '429',
      attempt: 1,
      maxAttempts: 3,
      delayMs: 1000
    });
    const failed = mapEvent({ type: 'auto_retry_end', success: false, finalError: 'still 429', attempt: 3 });

    expect(retrying.message).toMatchObject({
      role: 'assistant',
      stopReason: 'error',
      errorMessage: '429',
      retry: { status: 'retrying', attempt: 1, maxAttempts: 3, delayMs: 1000 }
    });
    expect(failed.message).toMatchObject({
      role: 'assistant',
      stopReason: 'error',
      errorMessage: 'still 429',
      retry: { status: 'failed', attempt: 3, maxAttempts: 3 }
    });
  });

  it('maps final agent errors unless aborted', () => {
    const event = {
      type: 'agent_end',
      willRetry: false,
      messages: [{ role: 'assistant', stopReason: 'error', errorMessage: 'boom' }]
    };

    expect(mapEvent(event)).toMatchObject({
      done: true,
      message: { role: 'assistant', stopReason: 'error', errorMessage: 'boom' }
    });
    expect(mapEvent(event, true)).toEqual({ done: true, message: undefined });
  });
});
