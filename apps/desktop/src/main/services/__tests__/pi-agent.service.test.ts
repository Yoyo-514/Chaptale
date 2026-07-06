import { describe, expect, it, vi } from 'vitest';

import { PiAgentService } from '../pi-agent.service';

function createFakeSession(promptImpl?: (emit: (event: any) => void) => Promise<void> | void) {
  let subscriber: ((event: any) => void) | undefined;
  const sessionManager = {
    branch: vi.fn(),
    resetLeaf: vi.fn(),
    buildSessionContext: vi.fn(() => ({ messages: ['context-message'] })),
    _rewriteFile: vi.fn()
  };
  const session = {
    model: { provider: 'old-provider', id: 'old-model' },
    messages: [],
    agent: { state: { messages: [] as unknown[] } },
    sessionManager,
    setModel: vi.fn(async (model: any) => {
      session.model = model;
    }),
    subscribe: vi.fn((callback: (event: any) => void) => {
      subscriber = callback;
      return vi.fn();
    }),
    prompt: vi.fn(async () => {
      await promptImpl?.(event => subscriber?.(event));
    }),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  };

  return { session, sessionManager };
}

function createService(session: any, defaultModel: any = { provider: 'new-provider', id: 'new-model' }) {
  const service = new PiAgentService({} as any, { getDefaultPiModel: vi.fn(async () => defaultModel) } as any);
  (service as any).sessionFactory = { create: vi.fn(async () => session) };
  return service;
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

describe('PiAgentService', () => {
  it('bridges agent session events to chat messages and flushes the session file', async () => {
    const { session, sessionManager } = createFakeSession(async emit => {
      emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_start' } });
      emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_delta', delta: '思考' } });
      emit({ type: 'message_update', assistantMessageEvent: { type: 'thinking_end' } });
      emit({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: '你好' } });
      emit({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'web_search', args: { query: 'Chaptale' } });
      emit({ type: 'tool_execution_end', toolCallId: 'tool-1', toolName: 'web_search', result: { ok: true } });
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session);

    const messages = await collect(
      service.stream({ sessionId: 'session-1', query: 'hi', signal: new AbortController().signal })
    );

    expect(session.setModel).toHaveBeenCalledWith({ provider: 'new-provider', id: 'new-model' });
    expect(messages).toEqual([
      expect.objectContaining({ role: 'assistant', partial: true, content: [] }),
      expect.objectContaining({
        role: 'assistant',
        partial: true,
        content: [{ type: 'thinking', thinking: '思考', thinkingSignature: 'reasoning_content' }]
      }),
      expect.objectContaining({ role: 'assistant', partial: false, content: [] }),
      expect.objectContaining({ role: 'assistant', partial: true, content: [{ type: 'text', text: '你好' }] }),
      expect.objectContaining({
        role: 'assistant',
        stopReason: 'toolUse',
        content: [{ type: 'toolCall', id: 'tool-1', name: 'web_search', arguments: { query: 'Chaptale' } }]
      }),
      expect.objectContaining({ role: 'toolResult', toolCallId: 'tool-1', toolName: 'web_search' })
    ]);
    expect(sessionManager._rewriteFile).toHaveBeenCalled();
  });

  it('branches or resets the session context before prompting', async () => {
    const { session, sessionManager } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session, null);

    await collect(
      service.stream({
        sessionId: 'session-1',
        query: 'branch',
        branchFromEntryId: 'entry-1',
        signal: new AbortController().signal
      })
    );
    expect(sessionManager.branch).toHaveBeenCalledWith('entry-1');
    expect(session.agent.state.messages).toEqual(['context-message']);

    await collect(
      service.stream({
        sessionId: 'session-1',
        query: 'reset',
        branchFromEntryId: null,
        signal: new AbortController().signal
      })
    );
    expect(sessionManager.resetLeaf).toHaveBeenCalled();
  });

  it('reports auto retry and final agent errors as assistant messages', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'auto_retry_start', errorMessage: '429', attempt: 1, maxAttempts: 3, delayMs: 100 });
      emit({ type: 'auto_retry_end', success: false, finalError: '仍然失败', attempt: 3 });
      emit({
        type: 'agent_end',
        willRetry: false,
        messages: [{ stopReason: 'error', errorMessage: '最终失败' }]
      });
    });
    const service = createService(session);

    const messages = await collect(
      service.stream({ sessionId: 'session-1', query: 'retry', signal: new AbortController().signal })
    );

    expect(messages).toEqual([
      expect.objectContaining({
        role: 'assistant',
        errorMessage: '429',
        retry: expect.objectContaining({ status: 'retrying' })
      }),
      expect.objectContaining({
        role: 'assistant',
        errorMessage: '仍然失败',
        retry: expect.objectContaining({ status: 'failed' })
      }),
      expect.objectContaining({ role: 'assistant', errorMessage: '最终失败', stopReason: 'error' })
    ]);
  });

  it('throws when no model is configured and aborts active sessions on invalidation', async () => {
    const { session } = createFakeSession();
    session.model = undefined as any;
    const service = createService(session, null);

    await expect(
      collect(service.stream({ sessionId: 'session-1', query: 'hi', signal: new AbortController().signal }))
    ).rejects.toThrow('尚未配置可用模型');

    await expect(
      collect(service.stream({ sessionId: 'session-2', query: 'hi', signal: AbortSignal.abort() }))
    ).rejects.toThrow('尚未配置可用模型');
    service.invalidateSessions();
    await Promise.resolve();
    expect(session.dispose).toHaveBeenCalled();
  });
});
