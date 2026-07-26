import type { WebContents } from 'electron';
import { EventEmitter } from 'node:events';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import type { AgentRunOptions, AgentRuntime, AgentStartPayload } from '@chaptale/ipc-contract';
import type { ChatMessage } from '@chaptale/shared';

import { registerAgentIpc } from '../ipc';

type ValidatedHandler = (event: { sender: WebContents }, ...args: any[]) => unknown;
type ValidatedRegistration = {
  channel: string;
  handler: ValidatedHandler;
};

const registrationMock = vi.hoisted(() => ({
  validated: [] as ValidatedRegistration[]
}));

vi.mock('../../../infra/security/trusted-ipc', () => ({
  handleTrustedIpc: vi.fn()
}));

vi.mock('../../../infra/security/validated-ipc', () => ({
  handleValidatedIpc: vi.fn(
    (
      _channel: string,
      _argsValidator: unknown,
      resultValidatorOrHandler: { Check(value: unknown): boolean } | ValidatedHandler,
      maybeHandler?: ValidatedHandler
    ) => {
      const resultValidator = maybeHandler
        ? (resultValidatorOrHandler as { Check(value: unknown): boolean })
        : undefined;
      const handler = maybeHandler ?? (resultValidatorOrHandler as ValidatedHandler);

      registrationMock.validated.push({
        channel: _channel,
        handler: (event, ...args) => {
          const checkResult = (value: unknown) => {
            if (resultValidator && !resultValidator.Check(value)) {
              throw new Error(`IPC 响应无效：${_channel}`);
            }

            return value;
          };

          return Promise.resolve()
            .then(() => handler(event, ...args))
            .then(checkResult);
        }
      });
    }
  )
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn()
  }
}));

function createDeferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(resolvePromise => {
    resolve = () => resolvePromise();
  });

  return { promise, resolve };
}

class FakeWebContents extends EventEmitter {
  readonly sendAttempts: string[] = [];
  readonly sent: Array<[string, unknown]> = [];
  private destroyOnNextSend = false;
  private destroyed = false;
  private sendError: Error | undefined;
  private readonly terminalSent = createDeferred();
  private readonly destroyedListenerRemoved = createDeferred();

  isDestroyed() {
    return this.destroyed;
  }

  send(channel: string, payload: unknown) {
    this.sendAttempts.push(channel);

    if (this.destroyOnNextSend) {
      this.destroyOnNextSend = false;
      this.destroy();
      throw new Error('Object has been destroyed');
    }

    if (this.sendError) {
      throw this.sendError;
    }

    this.sent.push([channel, payload]);

    if (channel === IPC_CHANNELS.agent.end) {
      this.terminalSent.resolve();
    }
  }

  failNextSendBecauseDestroyed() {
    this.destroyOnNextSend = true;
  }

  failSends(error: Error) {
    this.sendError = error;
  }

  destroy() {
    this.destroyed = true;
    this.emit('destroyed');
  }

  override removeListener(eventName: string | symbol, listener: (...args: any[]) => void): this {
    super.removeListener(eventName, listener);
    this.resolveDestroyedListenerRemoval(eventName);
    return this;
  }

  override off(eventName: string | symbol, listener: (...args: any[]) => void): this {
    super.off(eventName, listener);
    this.resolveDestroyedListenerRemoval(eventName);
    return this;
  }

  waitForTerminalSend() {
    return this.terminalSent.promise;
  }

  waitForDestroyedListenerRemoval() {
    return this.destroyedListenerRemoved.promise;
  }

  private resolveDestroyedListenerRemoval(eventName: string | symbol) {
    if (eventName === 'destroyed' && this.listenerCount('destroyed') === 0) {
      this.destroyedListenerRemoved.resolve();
    }
  }
}

type StreamControl = {
  started: ReturnType<typeof createDeferred>;
  release: ReturnType<typeof createDeferred>;
  finished: ReturnType<typeof createDeferred>;
  signal?: AbortSignal;
};

function createStreamControl(): StreamControl {
  return {
    started: createDeferred(),
    release: createDeferred(),
    finished: createDeferred()
  };
}

async function* controlledStream(control: StreamControl, options: AgentRunOptions) {
  control.signal = options.signal;
  control.started.resolve();

  try {
    await control.release.promise;
    yield { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } satisfies ChatMessage;
  } finally {
    control.finished.resolve();
  }
}

/** 创建带可观察 steer/clear 方法的测试 Runtime。 */
function createRuntime(control: StreamControl): AgentRuntime {
  return {
    stream: vi.fn((options: AgentRunOptions) => controlledStream(control, options)),
    steer: vi.fn(async () => undefined),
    clearPendingMessages: vi.fn(async () => ({ steering: [], followUp: [] })),
    getContextPressure: vi.fn(async () => ({
      tokens: 0,
      contextWindow: 100_000,
      percent: 0,
      thresholdPercent: 70,
      shouldPrompt: false
    })),
    compactSession: vi.fn(async sessionId => ({ sessionId, tokensBefore: 0, summaryRef: 'summary.md' }))
  };
}

/** 按 query 选择独立流控制器，验证并发运行互不影响。 */
function createRuntimeByQuery(controls: Record<string, StreamControl>): AgentRuntime {
  return {
    stream: vi.fn((options: AgentRunOptions) => controlledStream(controls[options.query]!, options)),
    steer: vi.fn(async () => undefined),
    clearPendingMessages: vi.fn(async () => ({ steering: [], followUp: [] })),
    getContextPressure: vi.fn(async () => ({
      tokens: 0,
      contextWindow: 100_000,
      percent: 0,
      thresholdPercent: 70,
      shouldPrompt: false
    })),
    compactSession: vi.fn(async sessionId => ({ sessionId, tokensBefore: 0, summaryRef: 'summary.md' }))
  };
}

function getValidatedHandler(channel: string): ValidatedHandler {
  const handler = registrationMock.validated.find(registration => registration.channel === channel)?.handler;

  if (!handler) {
    throw new Error(`未注册 IPC handler：${channel}`);
  }

  return handler;
}

function createPayload(runId = 'run-1', query = 'hello'): AgentStartPayload {
  return {
    runId,
    query,
    sessionId: 'session-1'
  };
}

describe('Agent IPC lifecycle', () => {
  beforeEach(() => {
    registrationMock.validated.length = 0;
  });

  it('aborts the sender run on destruction and does not send after destruction', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    registerAgentIpc({
      runtime: createRuntime(control),
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    await expect(start({ sender: sender as unknown as WebContents }, createPayload())).resolves.toEqual({
      runId: 'run-1'
    });
    await control.started.promise;
    expect.soft(sender.listenerCount('destroyed')).toBe(1);

    sender.destroy();
    expect.soft(control.signal?.aborted).toBe(true);

    control.release.resolve();
    await control.finished.promise;
    await Promise.race([sender.waitForTerminalSend(), sender.waitForDestroyedListenerRemoval()]);

    expect(sender.sent).toEqual([]);
  });

  it('does not abort another sender run when one sender is destroyed', async () => {
    const first = createStreamControl();
    const second = createStreamControl();
    const firstSender = new FakeWebContents();
    const secondSender = new FakeWebContents();
    registerAgentIpc({
      runtime: createRuntimeByQuery({ first, second }),
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    start({ sender: firstSender as unknown as WebContents }, createPayload('run-1', 'first'));
    start({ sender: secondSender as unknown as WebContents }, createPayload('run-2', 'second'));
    await Promise.all([first.started.promise, second.started.promise]);

    firstSender.destroy();

    expect(first.signal?.aborted).toBe(true);
    expect(second.signal?.aborted).toBe(false);

    first.release.resolve();
    second.release.resolve();
    await Promise.all([first.finished.promise, secondSender.waitForTerminalSend()]);
    await Promise.all([firstSender.waitForDestroyedListenerRemoval(), secondSender.waitForDestroyedListenerRemoval()]);

    expect(firstSender.sent).toEqual([]);
    expect(secondSender.sent.map(([channel]) => channel)).toEqual([IPC_CHANNELS.agent.message, IPC_CHANNELS.agent.end]);
  });

  it('rejects a duplicate active run id before it can replace the original run', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    registerAgentIpc({
      runtime: createRuntime(control),
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    start({ sender: sender as unknown as WebContents }, createPayload());
    await control.started.promise;

    await expect(
      start({ sender: sender as unknown as WebContents }, { ...createPayload(), sessionId: 'session-2' })
    ).rejects.toThrow('Agent runId 已存在：run-1');

    control.release.resolve();
    await sender.waitForDestroyedListenerRemoval();
  });

  it('swallows only the send failure caused by destruction between the check and send', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    sender.failNextSendBecauseDestroyed();
    registerAgentIpc({
      runtime: createRuntime(control),
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    start({ sender: sender as unknown as WebContents }, createPayload());
    await control.started.promise;
    control.release.resolve();
    await control.finished.promise;
    await Promise.race([sender.waitForTerminalSend(), sender.waitForDestroyedListenerRemoval()]);

    expect(control.signal?.aborted).toBe(true);
    expect(sender.sendAttempts).toEqual([IPC_CHANNELS.agent.message]);
    expect(sender.sent).toEqual([]);
  });

  it('routes non-destruction send failures to the detached rejection endpoint', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    sender.failSends(new Error('transport failed'));
    registerAgentIpc({
      runtime: createRuntime(control),
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    start({ sender: sender as unknown as WebContents }, createPayload());
    await control.started.promise;
    control.release.resolve();
    await control.finished.promise;
    await sender.waitForDestroyedListenerRemoval();
    await new Promise<void>(resolve => setImmediate(resolve));

    expect(sender.sendAttempts).toEqual([IPC_CHANNELS.agent.message]);
    expect(sender.sent).toEqual([]);
  });

  it('keeps start and cancel results while ending a live sender as cancelled', async () => {
    const started = createDeferred();
    const sender = new FakeWebContents();
    const runtime: AgentRuntime = {
      stream: vi.fn(async function* (options: AgentRunOptions) {
        started.resolve();
        await new Promise<void>(resolve => {
          if (options.signal.aborted) {
            resolve();
            return;
          }

          options.signal.addEventListener('abort', () => resolve(), { once: true });
        });

        if (!options.signal.aborted) {
          yield { role: 'assistant', content: [] } satisfies ChatMessage;
        }
      }),
      steer: vi.fn(async () => undefined),
      clearPendingMessages: vi.fn(async () => ({ steering: [], followUp: [] })),
      getContextPressure: vi.fn(async () => ({
        tokens: 0,
        contextWindow: 100_000,
        percent: 0,
        thresholdPercent: 70,
        shouldPrompt: false
      })),
      compactSession: vi.fn(async sessionId => ({ sessionId, tokensBefore: 0, summaryRef: 'summary.md' }))
    };
    registerAgentIpc({
      runtime: runtime,
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);
    const cancel = getValidatedHandler(IPC_CHANNELS.agent.cancel);

    await expect(start({ sender: sender as unknown as WebContents }, createPayload())).resolves.toEqual({
      runId: 'run-1'
    });
    await started.promise;
    await expect(cancel({ sender: sender as unknown as WebContents }, 'run-1')).resolves.toEqual({ runId: 'run-1' });
    await sender.waitForTerminalSend();
    await sender.waitForDestroyedListenerRemoval();

    expect(sender.sent).toEqual([[IPC_CHANNELS.agent.end, { runId: 'run-1', end: { status: 'cancelled' } }]]);
  });

  it('routes steer and clear requests through the session registered for the active run', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    const runtime = createRuntime(control);
    vi.mocked(runtime.clearPendingMessages).mockResolvedValue({ steering: ['调整方向'], followUp: [] });
    registerAgentIpc({
      runtime: runtime,
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);
    const steer = getValidatedHandler(IPC_CHANNELS.agent.steer);
    const clearPendingMessages = getValidatedHandler(IPC_CHANNELS.agent.clearPendingMessages);

    await expect(start({ sender: sender as unknown as WebContents }, createPayload())).resolves.toEqual({
      runId: 'run-1'
    });
    await control.started.promise;

    await expect(
      steer(
        { sender: sender as unknown as WebContents },
        { runId: 'run-1', query: '调整方向', contextFilePaths: ['C:/outline.md'] }
      )
    ).resolves.toEqual({ runId: 'run-1' });
    expect(runtime.steer).toHaveBeenCalledWith({
      sessionId: 'session-1',
      signal: expect.any(AbortSignal),
      query: '调整方向',
      contextFilePaths: ['C:/outline.md']
    });
    await expect(
      clearPendingMessages({ sender: sender as unknown as WebContents }, { runId: 'run-1' })
    ).resolves.toEqual({
      runId: 'run-1',
      queue: { steering: ['调整方向'], followUp: [] }
    });
    expect(runtime.clearPendingMessages).toHaveBeenCalledWith({
      sessionId: 'session-1',
      signal: expect.any(AbortSignal)
    });
    expect(runtime.stream).toHaveBeenCalledTimes(1);

    control.release.resolve();
    await sender.waitForTerminalSend();
  });

  it('rejects an invalid clearPendingMessages response before it reaches Renderer', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    const runtime = createRuntime(control);
    vi.mocked(runtime.clearPendingMessages).mockResolvedValue({ steering: '坏队列', followUp: [] } as never);
    registerAgentIpc({
      runtime: runtime,
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);
    const clearPendingMessages = getValidatedHandler(IPC_CHANNELS.agent.clearPendingMessages);

    await expect(start({ sender: sender as unknown as WebContents }, createPayload())).resolves.toEqual({
      runId: 'run-1'
    });
    await control.started.promise;

    await expect(
      clearPendingMessages({ sender: sender as unknown as WebContents }, { runId: 'run-1' })
    ).rejects.toThrow(`IPC 响应无效：${IPC_CHANNELS.agent.clearPendingMessages}`);

    control.release.resolve();
    await sender.waitForTerminalSend();
  });

  it('unwraps thenable IPC results before running the response validator', async () => {
    const { handleValidatedIpc } = await import('../../../infra/security/validated-ipc');

    class TestThenable {
      // oxlint-disable-next-line unicorn/no-thenable
      then(resolve: (value: { runId: string }) => void) {
        resolve({ runId: 'run-1' });
      }
    }

    handleValidatedIpc(
      'test:thenable-response',
      { Check: (_value: unknown): _value is [] => true },
      {
        Check: (value: unknown): value is { runId: string } =>
          typeof value === 'object' && value !== null && 'runId' in value
      },
      () => new TestThenable() as unknown as Promise<{ runId: string }>
    );

    const handler = getValidatedHandler('test:thenable-response');

    await expect(handler({ sender: new FakeWebContents() as unknown as WebContents })).resolves.toEqual({
      runId: 'run-1'
    });
  });

  it('invalidates an in-flight steer when its original run finishes', async () => {
    const control = createStreamControl();
    const steerStarted = createDeferred();
    const releaseSteer = createDeferred();
    const sender = new FakeWebContents();
    const runtime = createRuntime(control);
    vi.mocked(runtime.steer).mockImplementation(async (options: any) => {
      steerStarted.resolve();
      await releaseSteer.promise;
      options.signal.throwIfAborted();
    });
    registerAgentIpc({
      runtime: runtime,
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);
    const steer = getValidatedHandler(IPC_CHANNELS.agent.steer);

    start({ sender: sender as unknown as WebContents }, createPayload());
    await control.started.promise;
    const pendingSteer = Promise.resolve(
      steer({ sender: sender as unknown as WebContents }, { runId: 'run-1', query: '调整方向' })
    );
    await steerStarted.promise;

    control.release.resolve();
    await sender.waitForDestroyedListenerRemoval();
    releaseSteer.resolve();

    await expect(pendingSteer).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('rejects steer for unknown runs and whitespace-only input', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    registerAgentIpc({
      runtime: createRuntime(control),
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);
    const steer = getValidatedHandler(IPC_CHANNELS.agent.steer);

    await expect(
      steer({ sender: sender as unknown as WebContents }, { runId: 'missing', query: '调整' })
    ).rejects.toThrow('运行已结束');

    start({ sender: sender as unknown as WebContents }, createPayload());
    await control.started.promise;
    await expect(steer({ sender: sender as unknown as WebContents }, { runId: 'run-1', query: '   ' })).rejects.toThrow(
      'steer 内容不能为空'
    );

    control.release.resolve();
    await sender.waitForTerminalSend();
  });

  it('sends a complete failed end for a real runtime exception', async () => {
    const sender = new FakeWebContents();
    const runtime = createRuntime(createStreamControl());
    runtime.stream = vi.fn(async function* () {
      await new Promise<never>((_resolve, reject) => reject(new Error('runtime failed')));
      yield { role: 'assistant', content: [] } satisfies ChatMessage;
    });
    registerAgentIpc({
      runtime: runtime,
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    start({ sender: sender as unknown as WebContents }, createPayload());
    await sender.waitForTerminalSend();
    await sender.waitForDestroyedListenerRemoval();

    expect(sender.sent).toEqual([
      [
        IPC_CHANNELS.agent.end,
        {
          runId: 'run-1',
          end: {
            status: 'failed',
            code: 'AGENT_RUN_FAILED',
            message: 'runtime failed',
            retryable: false
          }
        }
      ]
    ]);
  });

  it('removes the destroyed listener after a normal stream completes', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    registerAgentIpc({
      runtime: createRuntime(control),
      contextFileService: { selectFiles: vi.fn(async () => []), inspectFiles: vi.fn(async () => []) },
      ui: { resolveOwner: vi.fn(() => undefined) }
    });
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    start({ sender: sender as unknown as WebContents }, createPayload());
    await control.started.promise;
    expect(sender.listenerCount('destroyed')).toBe(1);

    control.release.resolve();
    await sender.waitForTerminalSend();
    await sender.waitForDestroyedListenerRemoval();

    expect(sender.listenerCount('destroyed')).toBe(0);
    expect(sender.sent).toEqual([
      [
        IPC_CHANNELS.agent.message,
        { runId: 'run-1', message: { role: 'assistant', content: [{ type: 'text', text: 'reply' }] } }
      ],
      [IPC_CHANNELS.agent.end, { runId: 'run-1', end: { status: 'completed' } }]
    ]);
  });
});
