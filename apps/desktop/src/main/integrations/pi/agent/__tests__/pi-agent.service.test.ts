import { describe, expect, it, vi } from 'vitest';

import { ContextFileService } from '../../../../modules/context/service';
import { InputAssembler } from '../input-assembler';
import { PiAgentService } from '../service';

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
    isStreaming: true,
    isCompacting: false,
    messages: [],
    getSessionStats: vi.fn(() => ({
      contextUsage: { tokens: 72_000, contextWindow: 100_000, percent: 72 }
    })),
    compact: vi.fn(async () => ({
      summary: '压缩摘要',
      firstKeptEntryId: 'entry-2',
      tokensBefore: 72_000,
      estimatedTokensAfter: 18_000,
      details: {
        kind: 'chaptale-creative-checkpoint',
        schemaVersion: 1,
        checkpointId: 'entry-2',
        summaryRef: '.chaptale/memory/summaries/compactions/summary.md',
        distillerRunId: 'run-distill',
        memoryRefs: ['author:preferences']
      }
    })),
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
    steer: vi.fn(async () => undefined),
    clearQueue: vi.fn(() => ({ steering: [], followUp: [] })),
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
  imageAttachmentService = createImageAttachmentService(),
  options?: {
    settingsService?: any;
    memoryInjector?: any;
    sessionCtx?: { sessionId?: string; cwd: string; scope: 'global' | 'workspace' };
  }
) {
  const settingsService =
    options?.settingsService ??
    ({ rootDir: '/tmp/chaptale-test', getCurrentCwd: vi.fn(async () => '/tmp/chaptale-test-cwd') } as any);
  const memoryInjector =
    options?.memoryInjector ??
    ({
      // memory 注入与对话主流程解耦，这里用空实现；注入行为由 memory 专项测试覆盖。
      resolvePrefix: vi.fn(async () => ''),
      reset: vi.fn()
    } as any);
  const assemblerDeps: any = {
    contextFileService: new ContextFileService({
      selectContextFilePaths: async () => [],
      createImagePreview: async () => undefined
    }),
    imageAttachmentService
  };
  const service = new PiAgentService({
    chatFactory: {
      create: vi.fn(async (sessionId: string) => ({
        session,
        ctx: {
          sessionId,
          cwd: options?.sessionCtx?.cwd ?? (await settingsService.getCurrentCwd()),
          scope: options?.sessionCtx?.scope ?? 'workspace'
        }
      }))
    } as any,
    modelService: { getDefaultPiModel: vi.fn(async () => defaultModel) } as any,
    memoryInjector,
    permissionBroker: { rejectSession: vi.fn() } as any,
    inputAssembler: new InputAssembler({
      // 用可变引用转发，测试可在构造后替换 fake，仍走真实组装逻辑。
      contextFileService: { resolve: (...args) => assemblerDeps.contextFileService.resolve(...args) },
      imageAttachmentService: {
        createPresentation: (...args) => assemblerDeps.imageAttachmentService.createPresentation(...args)
      }
    })
  });
  (service as any).assemblerDeps = assemblerDeps;
  return service;
}

async function collect<T>(iterable: AsyncIterable<T>) {
  const items: T[] = [];
  for await (const item of iterable) {
    items.push(item);
  }
  return items;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(resolvePromise => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

describe('PiAgentService', () => {
  it('uses the restored session workspace for memory injection instead of the current UI workspace', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const settingsService = {
      rootDir: '/tmp/chaptale-test',
      getCurrentCwd: vi.fn(async () => 'E:/works/workspace-b')
    };
    const memoryInjector = {
      resolvePrefix: vi.fn(async () => '记忆前缀'),
      reset: vi.fn()
    };
    const service = createService(
      session,
      { provider: 'new-provider', id: 'new-model' },
      createImageAttachmentService(),
      {
        settingsService,
        memoryInjector,
        sessionCtx: { cwd: 'E:/works/workspace-a', scope: 'workspace' }
      }
    );

    await collect(service.stream({ sessionId: 'session-1', query: 'hi', signal: new AbortController().signal }));

    expect(memoryInjector.resolvePrefix).toHaveBeenCalledWith('session-1', 'E:/works/workspace-a');
    expect(memoryInjector.resolvePrefix).not.toHaveBeenCalledWith('session-1', 'E:/works/workspace-b');
  });

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

  it('emits consumed steer user messages without duplicating the initial prompt event', async () => {
    const { session } = createFakeSession(async emit => {
      emit({
        type: 'message_start',
        message: { role: 'user', content: [{ type: 'text', text: '初始问题' }], timestamp: 1 }
      });
      emit({
        type: 'message_start',
        message: { role: 'user', content: [{ type: 'text', text: '调整方向' }], timestamp: 2 }
      });
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session);

    const messages = await collect(
      service.stream({ sessionId: 'session-1', query: '初始问题', signal: new AbortController().signal })
    );

    expect(messages.filter(message => message.role === 'user')).toEqual([
      expect.objectContaining({ role: 'user', content: '初始问题' }),
      { role: 'user', content: '调整方向', timestamp: 2 }
    ]);
  });

  it('delegates skill expansion to pi while keeping attachment context in the command arguments', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session);
    const promptPrefix =
      '<attached_context_files>\n<file path="C:/novel/outline.md" handling="file-input-text" size="2 KB">正文</file>\n</attached_context_files>\n\n';
    (service as any).assemblerDeps.contextFileService = {
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

  it('resolves context files and maps one-based image block indexes to context-file sources', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const imageAttachmentService = createImageAttachmentService();
    const service = createService(session, { provider: 'new-provider', id: 'new-model' }, imageAttachmentService);
    const images = [
      { type: 'image', data: 'cover-base64', mimeType: 'image/png' },
      { type: 'image', data: 'map-base64', mimeType: 'image/jpeg' }
    ];
    const imagePaths = ['C:/novel/cover.png', 'C:/novel/map.jpg'];
    const contextFileService = {
      resolve: vi.fn().mockResolvedValue({
        promptPrefix: '<attached_context_files>文件内容</attached_context_files>\n\n',
        images,
        imagePaths
      })
    };
    (service as any).assemblerDeps.contextFileService = contextFileService;

    const messages = await collect(
      service.stream({
        sessionId: 'session-1',
        query: '请分析附件',
        contextFilePaths: ['C:/novel/outline.md', ...imagePaths],
        signal: new AbortController().signal
      })
    );

    expect(contextFileService.resolve).toHaveBeenCalledWith(['C:/novel/outline.md', ...imagePaths]);
    expect(imageAttachmentService.createPresentation).toHaveBeenCalledWith(
      [
        { ...images[0], blockIndex: 1 },
        { ...images[1], blockIndex: 2 }
      ],
      expect.any(Function)
    );
    expect(messages[0]).toMatchObject({
      role: 'user',
      content: [
        { type: 'text', text: '请分析附件' },
        { source: { type: 'context-file', path: imagePaths[0] } },
        { source: { type: 'context-file', path: imagePaths[1] } }
      ]
    });
    expect(session.prompt).toHaveBeenCalledWith(
      '<attached_context_files>文件内容</attached_context_files>\n\n请分析附件',
      { images }
    );
  });

  it('resolves context files and delegates steer to the active Pi session', async () => {
    const { session } = createFakeSession();
    const service = createService(session);
    const images = [{ type: 'image', data: 'cover-base64', mimeType: 'image/png' }];
    const contextFileService = {
      resolve: vi.fn().mockResolvedValue({
        promptPrefix: '<attached_context_files>人物资料</attached_context_files>\n\n',
        images,
        imagePaths: ['C:/novel/cover.png']
      })
    };
    (service as any).assemblerDeps.contextFileService = contextFileService;

    await service.steer({
      sessionId: 'session-1',
      signal: new AbortController().signal,
      query: '调整人物动机',
      contextFilePaths: ['C:/novel/character.md', 'C:/novel/cover.png']
    });

    expect(contextFileService.resolve).toHaveBeenCalledWith(['C:/novel/character.md', 'C:/novel/cover.png']);
    expect(session.steer).toHaveBeenCalledWith(
      '<attached_context_files>人物资料</attached_context_files>\n\n调整人物动机',
      images
    );
  });

  it('never reloads or switches the model on the actively streaming session during steer', async () => {
    const { session } = createFakeSession();
    const service = createService(session);
    (service as any).assemblerDeps.contextFileService = {
      resolve: vi.fn().mockResolvedValue({ promptPrefix: '', images: [], imagePaths: [] })
    };

    await service.steer({
      sessionId: 'session-1',
      signal: new AbortController().signal,
      query: '/skill:review 检查第一章'
    });

    // reload 会重建 runtime、setModel 会改写运行中的 agent 状态，两者都不得在活跃运行中触发；
    // skill 展开由 Pi steer() 自身完成。
    expect(session.reload).not.toHaveBeenCalled();
    expect(session.setModel).not.toHaveBeenCalled();
    expect(session.steer).toHaveBeenCalledWith('/skill:review 检查第一章', []);
  });

  it('rejects steer when the Pi session is no longer streaming', async () => {
    const { session } = createFakeSession();
    session.isStreaming = false;
    const service = createService(session);

    await expect(
      service.steer({ sessionId: 'session-1', signal: new AbortController().signal, query: '调整方向' })
    ).rejects.toThrow('运行已结束');
    expect(session.steer).not.toHaveBeenCalled();
  });

  it('rechecks streaming state after asynchronous context resolution', async () => {
    const { session } = createFakeSession();
    const service = createService(session);
    const contextResolved = createDeferred<any>();
    (service as any).assemblerDeps.contextFileService = { resolve: vi.fn(() => contextResolved.promise) };

    const result = service.steer({
      sessionId: 'session-1',
      signal: new AbortController().signal,
      query: '调整方向',
      contextFilePaths: ['C:/novel/outline.md']
    });
    await Promise.resolve();
    session.isStreaming = false;
    contextResolved.resolve({ promptPrefix: '', images: [], imagePaths: [] });

    await expect(result).rejects.toThrow('运行已结束');
    expect(session.steer).not.toHaveBeenCalled();
  });

  it('rejects an old-run steer after that run is invalidated during context IO', async () => {
    const { session } = createFakeSession();
    const service = createService(session);
    const contextResolved = createDeferred<any>();
    const controller = new AbortController();
    (service as any).assemblerDeps.contextFileService = { resolve: vi.fn(() => contextResolved.promise) };

    const result = service.steer({
      sessionId: 'session-1',
      query: '旧运行调整',
      contextFilePaths: ['C:/novel/outline.md'],
      signal: controller.signal
    } as any);
    await Promise.resolve();
    controller.abort();
    session.isStreaming = true;
    contextResolved.resolve({ promptPrefix: '', images: [], imagePaths: [] });

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.steer).not.toHaveBeenCalled();
  });

  it('rejects queue clearing after the original run is invalidated', async () => {
    const { session } = createFakeSession();
    const service = createService(session);
    const pendingSession = createDeferred<any>();
    (service as any).options.chatFactory = { create: vi.fn(() => pendingSession.promise) };
    const controller = new AbortController();

    const result = service.clearPendingMessages({ sessionId: 'session-1', signal: controller.signal } as any);
    controller.abort();
    pendingSession.resolve({
      session,
      ctx: { sessionId: 'session-1', cwd: '/tmp/chaptale-test-cwd', scope: 'workspace' }
    });

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.clearQueue).not.toHaveBeenCalled();
  });

  it('delegates pending-message clearing to Pi AgentSession', async () => {
    const { session } = createFakeSession();
    session.clearQueue.mockReturnValue({ steering: ['调整方向'], followUp: ['继续检查'] });
    const service = createService(session);

    await expect(
      service.clearPendingMessages({ sessionId: 'session-1', signal: new AbortController().signal } as any)
    ).resolves.toEqual({
      steering: ['调整方向'],
      followUp: ['继续检查']
    });
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
    (service as any).assemblerDeps.contextFileService = contextFileService;

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

  it('aborts an active session without prompting when cancellation happens at the user-message yield', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    session.abort.mockRejectedValue(new Error('abort failed'));
    const service = createService(session);
    const controller = new AbortController();
    const iterator = service.stream({ sessionId: 'session-1', query: 'hi', signal: controller.signal });

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { role: 'user', content: 'hi' }
    });

    controller.abort();

    await expect(iterator.next()).rejects.toMatchObject({ name: 'AbortError' });
    await Promise.resolve();
    expect(session.clearQueue).toHaveBeenCalledTimes(1);
    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('rejects a pending queue read when an agent message arrives after cancellation', async () => {
    const promptStarted = createDeferred<void>();
    const finishPrompt = createDeferred<void>();
    let emitAgentEvent!: (event: any) => void;
    const { session } = createFakeSession(async emit => {
      emitAgentEvent = emit;
      promptStarted.resolve(undefined);
      await finishPrompt.promise;
    });
    const service = createService(session);
    const controller = new AbortController();
    const iterator = service.stream({ sessionId: 'session-1', query: 'hi', signal: controller.signal });

    await expect(iterator.next()).resolves.toMatchObject({
      done: false,
      value: { role: 'user', content: 'hi' }
    });

    const pendingNext = iterator.next();
    await promptStarted.promise;
    controller.abort();
    emitAgentEvent({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'late' } });
    emitAgentEvent({ type: 'agent_end', willRetry: false, messages: [] });
    finishPrompt.resolve(undefined);

    await expect(pendingNext).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.abort).toHaveBeenCalledTimes(1);
  });

  it('does not prompt when aborted while session preparation is pending', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session);
    const pendingSession = createDeferred<any>();
    const create = vi.fn(() => pendingSession.promise);
    (service as any).options.chatFactory = { create };
    const controller = new AbortController();

    const result = collect(service.stream({ sessionId: 'session-1', query: 'hi', signal: controller.signal }));
    expect(create).toHaveBeenCalledWith('session-1');

    controller.abort();
    pendingSession.resolve({
      session,
      ctx: { sessionId: 'session-1', cwd: '/tmp/chaptale-test-cwd', scope: 'workspace' }
    });
    const outcome = await result.then(
      () => undefined,
      error => error
    );

    expect(session.abort).toHaveBeenCalledTimes(1);
    expect(session.prompt).not.toHaveBeenCalled();
    expect(outcome).toMatchObject({ name: 'AbortError' });
  });

  it('rejects pre-aborted runs without prompting', async () => {
    const { session } = createFakeSession(async emit => {
      emit({ type: 'agent_end', willRetry: false, messages: [] });
    });
    const service = createService(session);

    const result = collect(service.stream({ sessionId: 'session-1', query: 'hi', signal: AbortSignal.abort() }));

    await expect(result).rejects.toMatchObject({ name: 'AbortError' });
    expect(session.abort).not.toHaveBeenCalled();
    expect(session.prompt).not.toHaveBeenCalled();
  });

  it('throws when no model is configured and disposes cached sessions on invalidation', async () => {
    const { session } = createFakeSession();
    session.model = undefined as any;
    const service = createService(session, null);

    await expect(
      collect(service.stream({ sessionId: 'session-1', query: 'hi', signal: new AbortController().signal }))
    ).rejects.toThrow('尚未配置可用模型');

    service.invalidateSessions();
    await Promise.resolve();
    expect(session.dispose).toHaveBeenCalled();
  });

  it('reports author-facing context pressure from the SDK session usage', async () => {
    const { session } = createFakeSession();
    const service = createService(session);

    await expect(service.getContextPressure('session-1')).resolves.toEqual({
      tokens: 72_000,
      contextWindow: 100_000,
      percent: 72,
      thresholdPercent: 70,
      shouldPrompt: true
    });
  });

  it('returns the memory checkpoint reference produced before custom compaction', async () => {
    const { session } = createFakeSession();
    session.isStreaming = false;
    const service = createService(session);

    await expect(service.compactSession('session-1')).resolves.toEqual({
      sessionId: 'session-1',
      tokensBefore: 72_000,
      estimatedTokensAfter: 18_000,
      summaryRef: '.chaptale/memory/summaries/compactions/summary.md'
    });
    expect(session.compact).toHaveBeenCalledWith();
  });

  it('rejects native results without a persisted Chaptale checkpoint', async () => {
    const { session } = createFakeSession();
    session.isStreaming = false;
    session.compact.mockResolvedValueOnce({
      summary: 'native coding 摘要',
      firstKeptEntryId: 'entry-2',
      tokensBefore: 72_000
    });
    const service = createService(session);

    await expect(service.compactSession('session-1')).rejects.toThrow('创作压缩扩展未生效');
  });

  it('refuses manual compaction while the agent is streaming', async () => {
    const { session } = createFakeSession();
    const service = createService(session);

    await expect(service.compactSession('session-1')).rejects.toThrow('运行中不能压缩会话');
    expect(session.compact).not.toHaveBeenCalled();
  });

  it('refuses a second compaction while one is already running', async () => {
    const { session } = createFakeSession();
    session.isStreaming = false;
    session.isCompacting = true;
    const service = createService(session);

    await expect(service.compactSession('session-1')).rejects.toThrow('会话正在压缩');
    expect(session.compact).not.toHaveBeenCalled();
  });
});
