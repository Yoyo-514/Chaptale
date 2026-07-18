import { EventEmitter } from 'node:events';

import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerAgentIpc } from '../ipc';

import type { AgentRunOptions, AgentRuntime, AgentStartPayload } from '@chaptale/ipc-contract';
import type { ChatMessage } from '@chaptale/shared';
import type { WebContents } from 'electron';

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
  handleValidatedIpc: vi.fn((_channel: string, _validator: unknown, handler: ValidatedHandler) => {
    registrationMock.validated.push({ channel: _channel, handler });
  })
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

    if (channel === IPC_CHANNELS.agent.done || channel === IPC_CHANNELS.agent.error) {
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

function createRuntime(control: StreamControl): AgentRuntime {
  return {
    stream: vi.fn((options: AgentRunOptions) => controlledStream(control, options))
  };
}

function createRuntimeByQuery(controls: Record<string, StreamControl>): AgentRuntime {
  return {
    stream: vi.fn((options: AgentRunOptions) => controlledStream(controls[options.query]!, options))
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
    registerAgentIpc(createRuntime(control));
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);

    expect(start({ sender: sender as unknown as WebContents }, createPayload())).toEqual({ runId: 'run-1' });
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
    registerAgentIpc(createRuntimeByQuery({ first, second }));
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
    expect(secondSender.sent.map(([channel]) => channel)).toEqual([
      IPC_CHANNELS.agent.message,
      IPC_CHANNELS.agent.done
    ]);
  });

  it('swallows only the send failure caused by destruction between the check and send', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    sender.failNextSendBecauseDestroyed();
    registerAgentIpc(createRuntime(control));
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
    registerAgentIpc(createRuntime(control));
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

  it('keeps start and cancel results while ending a live sender with done', async () => {
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
      })
    };
    registerAgentIpc(runtime);
    const start = getValidatedHandler(IPC_CHANNELS.agent.start);
    const cancel = getValidatedHandler(IPC_CHANNELS.agent.cancel);

    expect(start({ sender: sender as unknown as WebContents }, createPayload())).toEqual({ runId: 'run-1' });
    await started.promise;
    expect(cancel({ sender: sender as unknown as WebContents }, 'run-1')).toEqual({ runId: 'run-1' });
    await sender.waitForTerminalSend();
    await sender.waitForDestroyedListenerRemoval();

    expect(sender.sent).toEqual([[IPC_CHANNELS.agent.done, { runId: 'run-1' }]]);
  });

  it('removes the destroyed listener after a normal stream completes', async () => {
    const control = createStreamControl();
    const sender = new FakeWebContents();
    registerAgentIpc(createRuntime(control));
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
      [IPC_CHANNELS.agent.done, { runId: 'run-1' }]
    ]);
  });
});
