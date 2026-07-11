import { describe, expect, it, vi } from 'vitest';

import { PiAgentService } from '../pi-agent.service';

function createFakeSession(promptImpl?: (emit: (event: any) => void) => Promise<void> | void) {
  let subscriber: ((event: any) => void) | undefined;
  const sessionManager = {
    getEntry: vi.fn(),
    branch: vi.fn(),
    resetLeaf: vi.fn(),
    buildSessionContext: vi.fn(() => ({ messages: ['context-message'] })),
    _rewriteFile: vi.fn()
  };
  const session: any = {
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
    resourceLoader: {
      getSkills: vi.fn(() => ({ skills: [], diagnostics: [] }))
    },
    reload: vi.fn(async () => undefined),
    abort: vi.fn(async () => undefined),
    dispose: vi.fn(async () => undefined)
  };

  return { session, sessionManager };
}

function createImageAttachmentService() {
  return {
    createPresentation: vi.fn((images: any[], sourceFactory?: (blockIndex: number) => any) => ({
      attachments: images.map(image => ({
        type: 'imageAttachment',
        id: `image-${image.blockIndex}`,
        mimeType: image.mimeType,
        originalBytes: 3,
        width: 100,
        height: 80,
        thumbnailDataUrl: 'data:image/png;base64,dGh1bWI=',
        source: sourceFactory?.(image.blockIndex)
      }))
    }))
  };
}

function createService(
  session: any,
  defaultModel: any = { provider: 'new-provider', id: 'new-model' },
  imageAttachmentService = createImageAttachmentService()
) {
  const service = new PiAgentService(
    {} as any,
    { getDefaultPiModel: vi.fn(async () => defaultModel) } as any,
    imageAttachmentService as any
  );
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
      expect.objectContaining({ role: 'user', content: 'hi' }),
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
    // eslint-disable-next-line no-underscore-dangle
    expect(sessionManager._rewriteFile).toHaveBeenCalled();
  });

  it('delegates skill expansion to pi while keeping attachment context in the command arguments', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session);
    const promptPrefix =
      '<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n';
    (service as any).contextFileService = {
      resolve: vi.fn().mockResolvedValue({ promptPrefix, images: [], imagePaths: [] })
    };

    const messages = await collect(
      service.stream({
        sessionId: 'session-1',
        query: '/skill:review 检查第一章',
        contextFilePaths: ['C:/novel/outline.md'],
        signal: new AbortController().signal
      })
    );

    expect(session.reload).toHaveBeenCalled();
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: '检查第一章',
      skillInvocation: { name: 'review', arguments: '检查第一章' }
    });
    expect(session.prompt).toHaveBeenCalledWith(`/skill:review ${promptPrefix}检查第一章`, { images: [] });
  });

  it('resolves context files and forwards the prompt prefix and images to the agent session', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session);
    const image = { type: 'image', data: 'base64-data', mimeType: 'image/png' };
    const contextFileService = {
      resolve: vi.fn().mockResolvedValue({
        promptPrefix: '<attached_context_files>文件内容</attached_context_files>\n\n',
        images: [image],
        imagePaths: ['C:/novel/cover.png']
      })
    };
    (service as any).contextFileService = contextFileService;

    await collect(
      service.stream({
        sessionId: 'session-1',
        query: '请分析附件',
        contextFilePaths: ['C:/novel/outline.md', 'C:/novel/cover.png'],
        signal: new AbortController().signal
      })
    );

    expect(contextFileService.resolve).toHaveBeenCalledWith(['C:/novel/outline.md', 'C:/novel/cover.png']);
    expect(session.prompt).toHaveBeenCalledWith(
      '<attached_context_files>文件内容</attached_context_files>\n\n请分析附件',
      { images: [image] }
    );
  });

  it('reuses the persisted Pi user entry snapshot without reading local files again', async () => {
    const { session, sessionManager } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    sessionManager.getEntry.mockReturnValue({
      type: 'message',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: '<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n旧问题'
          },
          { type: 'image', data: 'YWJj', mimeType: 'image/png' }
        ]
      }
    });
    const imageAttachmentService = createImageAttachmentService();
    const service = createService(session, { provider: 'new-provider', id: 'new-model' }, imageAttachmentService);
    const contextFileService = { resolve: vi.fn() };
    (service as any).contextFileService = contextFileService;

    const messages = await collect(
      service.stream({
        sessionId: 'session-1',
        query: '新问题',
        branchFromEntryId: 'entry-parent',
        reuseUserEntryId: 'entry-user',
        signal: new AbortController().signal
      })
    );

    expect(contextFileService.resolve).not.toHaveBeenCalled();
    expect(sessionManager.getEntry).toHaveBeenCalledWith('entry-user');
    expect(sessionManager.branch).toHaveBeenCalledWith('entry-parent');
    expect(session.prompt).toHaveBeenCalledWith(
      '<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n新问题',
      { images: [{ type: 'image', data: 'YWJj', mimeType: 'image/png' }] }
    );
    expect(messages[0]).toMatchObject({
      role: 'user',
      contextFiles: [{ name: 'outline.md', kind: 'text' }],
      content: [
        { type: 'text', text: '新问题' },
        {
          type: 'imageAttachment',
          source: { type: 'session-entry', sessionId: 'session-1', entryId: 'entry-user', blockIndex: 1 }
        }
      ]
    });
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
      expect.objectContaining({ role: 'user', content: 'retry' }),
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
