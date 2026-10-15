import { runToolCall } from '@earendil-works/pi-agent-core';
import { InMemoryCredentialStore, type AssistantMessage, type JsonObject } from '@earendil-works/pi-ai';
import { defineTool, ModelRuntime, SessionManager, type AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Type } from 'typebox';

import {
  createHostSession,
  type HostToolAuthorizer,
  type HostToolDecision,
  type HostToolRequest
} from '../../../index.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

async function fixture(options: { authorize?: HostToolAuthorizer; nestedSignal?: AbortSignal } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-tool-behavior-'));
  const cwd = join(root, 'work');
  const agentDir = join(root, 'agent');
  await mkdir(cwd);
  await mkdir(agentDir);
  await writeFile(join(cwd, 'note.txt'), '真实文件中的验证内容');
  const requests: HostToolRequest[] = [];
  const events: AgentSessionEvent[] = [];
  let executions = 0;
  const read = defineTool({
    name: 'read_note',
    label: '读取验证文件',
    description: '读取已准备的验证文件。',
    parameters: Type.Object({ name: Type.Literal('note.txt') }),
    outputSchema: Type.Object({ text: Type.String() }),
    async execute(_id, args, signal, onUpdate) {
      signal?.throwIfAborted();
      executions++;
      const text = await readFile(join(cwd, args.name), 'utf8');
      const result = {
        content: [{ type: 'text' as const, text }],
        details: { name: args.name },
        structuredContent: { text }
      };
      onUpdate?.(result);
      return result;
    }
  });
  const parent = defineTool({
    name: 'read_through',
    label: '嵌套读取',
    description: '通过原生上下文调用读取工具。',
    parameters: Type.Object({ name: Type.Literal('note.txt') }),
    async execute(_id, args, _signal, _onUpdate, ctx) {
      const result = await ctx.executeTool(
        'read_note',
        args,
        options.nestedSignal ? { signal: options.nestedSignal } : undefined
      );
      return { ...result.result, isError: result.isError };
    }
  });
  // 这是工具协议的固定输入夹具，不是模型响应证据；没有替换 SDK 函数或请求模型。
  const assistant: AssistantMessage = {
    role: 'assistant',
    content: [{ type: 'toolCall', id: 'fixture', name: 'read_through', arguments: { name: 'note.txt' } }],
    api: 'openai-responses',
    provider: 'offline',
    model: 'tool-fixture',
    stopReason: 'toolUse',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  };
  const sessionManager = SessionManager.inMemory(cwd);
  sessionManager.appendMessage(assistant);
  const sessionOptions = {
    cwd,
    agentDir,
    sessionManager,
    systemPrompt: '工具边界的离线验证，不启动模型。',
    modelRuntime: await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      refreshOnCreate: false,
      allowModelNetwork: false
    }),
    toolAccess: {
      tools: [read, parent],
      authorize: async (request: HostToolRequest, signal: AbortSignal | undefined): Promise<HostToolDecision> => {
        requests.push(request);
        return options.authorize ? options.authorize(request, signal) : { allow: true };
      }
    }
  };
  const { session } = await createHostSession(sessionOptions);
  const unsubscribe = session.subscribe(event => events.push(event));
  let sequence = 0;
  return {
    cwd,
    session,
    sessionOptions,
    requests,
    events,
    get executions() {
      return executions;
    },
    call(name = 'read_note', args: JsonObject = { name: 'note.txt' }, signal?: AbortSignal) {
      return runToolCall(
        { type: 'toolCall', id: 'call-' + ++sequence, name, arguments: args },
        {
          assistantMessage: assistant,
          context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
          tools: session.agent.state.tools,
          beforeToolCall: session.agent.beforeToolCall,
          afterToolCall: session.agent.afterToolCall,
          signal
        }
      );
    },
    async dispose() {
      unsubscribe();
      await session.abort();
      session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  };
}

async function usingFixture(
  run: (value: Awaited<ReturnType<typeof fixture>>) => Promise<void>,
  options?: Parameters<typeof fixture>[0]
) {
  const value = await fixture(options);
  try {
    await run(value);
  } finally {
    await value.dispose();
  }
}

export const toolBehaviors: Array<{ name: string; run(): Promise<void> }> = [
  {
    name: '允许调用读取真实文件并保留原生结构化结果',
    run: () =>
      usingFixture(async value => {
        const outcome = await value.call();
        assert.equal(outcome.isError, false);
        assert.deepEqual(outcome.result.structuredContent, { text: '真实文件中的验证内容' });
        assert.deepEqual(value.requests, [
          {
            sessionId: value.session.sessionId,
            cwd: value.cwd,
            toolCallId: 'call-1',
            toolName: 'read_note',
            input: { name: 'note.txt' }
          }
        ]);
      })
  },
  {
    name: '拒绝调用不产生文件读取',
    run: () =>
      usingFixture(
        async value => {
          const outcome = await value.call();
          assert.equal(outcome.isError, true);
          assert.match(JSON.stringify(outcome.result.content), /作者拒绝读取/);
          assert.equal(value.executions, 0);
        },
        { authorize: async () => ({ allow: false, reason: '作者拒绝读取' }) }
      )
  },
  {
    name: '授权异常不泄露原始错误也不执行工具',
    run: () =>
      usingFixture(
        async value => {
          const outcome = await value.call();
          assert.equal(outcome.isError, true);
          assert.match(JSON.stringify(outcome.result.content), /工具授权失败/);
          assert.doesNotMatch(JSON.stringify(outcome.result), /private-policy-value/);
          assert.equal(value.executions, 0);
        },
        {
          authorize: async () => {
            throw new Error('private-policy-value');
          }
        }
      )
  },
  {
    name: '不合法授权返回值默认拒绝',
    run: () =>
      usingFixture(
        async value => {
          assert.equal((await value.call()).isError, true);
          assert.equal(value.executions, 0);
        },
        { authorize: async () => undefined as unknown as HostToolDecision }
      )
  },
  {
    name: '参数由 SDK 校验后才发起授权',
    run: () =>
      usingFixture(async value => {
        assert.equal((await value.call('read_note', { name: 'other.txt' })).isError, true);
        assert.equal(value.requests.length, 0);
        assert.equal(value.executions, 0);
      })
  },
  {
    name: '授权拿到快照而不是可修改的执行实参',
    run: () =>
      usingFixture(
        async value => {
          const outcome = await value.call();
          assert.equal(outcome.isError, false);
          assert.deepEqual(outcome.result.structuredContent, { text: '真实文件中的验证内容' });
        },
        {
          authorize: async request => {
            (request.input as { name: string }).name = 'other.txt';
            return { allow: true };
          }
        }
      )
  },
  {
    name: '撤销授权立即影响下一次调用',
    run: async () => {
      let allowed = true;
      await usingFixture(
        async value => {
          assert.equal((await value.call()).isError, false);
          allowed = false;
          assert.equal((await value.call()).isError, true);
          assert.equal(value.requests.length, 2);
          assert.equal(value.executions, 1);
        },
        { authorize: async () => ({ allow: allowed }) }
      );
    }
  },
  {
    name: '已取消的调用不请求授权',
    run: () =>
      usingFixture(async value => {
        const controller = new AbortController();
        controller.abort();
        assert.equal((await value.call('read_note', { name: 'note.txt' }, controller.signal)).isError, true);
        assert.equal(value.requests.length, 0);
        assert.equal(value.executions, 0);
      })
  },
  {
    name: '等待授权时取消且迟到的批准不执行工具',
    run: async () => {
      const entered = deferred<void>();
      const answer = deferred<HostToolDecision>();
      await usingFixture(
        async value => {
          const controller = new AbortController();
          const operation = value.call('read_note', { name: 'note.txt' }, controller.signal);
          await entered.promise;
          controller.abort();
          assert.equal((await operation).isError, true);
          answer.resolve({ allow: true });
          // 等待批准后的异步链完成，再检查工具是否产生副作用。
          await setImmediate();
          assert.equal(value.executions, 0);
        },
        {
          authorize: async () => {
            entered.resolve();
            return answer.promise;
          }
        }
      );
    }
  },
  {
    name: '嵌套工具逐项授权并携带原生父调用身份',
    run: () =>
      usingFixture(async value => {
        const outcome = await value.call('read_through');
        assert.equal(outcome.isError, false);
        assert.deepEqual(
          value.requests.map(request => request.toolName),
          ['read_through', 'read_note']
        );
        assert(
          value.events.some(
            event =>
              event.type === 'tool_execution_end' &&
              event.toolCallId === value.requests[1].toolCallId &&
              event.parentToolCallId === value.requests[0].toolCallId &&
              event.toolName === 'read_note'
          )
        );
        assert.equal(value.executions, 1);
      })
  },
  {
    name: '父工具获准不覆盖嵌套工具的拒绝',
    run: () =>
      usingFixture(
        async value => {
          assert.equal((await value.call('read_through')).isError, true);
          assert.deepEqual(
            value.requests.map(request => request.toolName),
            ['read_through', 'read_note']
          );
          assert.equal(value.executions, 0);
        },
        { authorize: async request => ({ allow: request.toolName === 'read_through' }) }
      )
  },
  {
    name: '嵌套调用独立取消不误用父调用信号',
    run: async () => {
      const entered = deferred<void>();
      const answer = deferred<HostToolDecision>();
      const nested = new AbortController();
      const parent = new AbortController();
      await usingFixture(
        async value => {
          const operation = value.call('read_through', { name: 'note.txt' }, parent.signal);
          await entered.promise;
          nested.abort();
          assert.equal((await operation).isError, true);
          assert.equal(parent.signal.aborted, false);
          answer.resolve({ allow: true });
          // 等待批准后的异步链完成，再检查工具是否产生副作用。
          await setImmediate();
          assert.equal(value.executions, 0);
        },
        {
          nestedSignal: nested.signal,
          authorize: async request => {
            if (request.toolName === 'read_through') return { allow: true };
            entered.resolve();
            return answer.promise;
          }
        }
      );
    }
  },
  {
    name: '额外激活内置工具不能绕过注册边界',
    run: () =>
      usingFixture(async value => {
        value.session.setActiveToolsByName(['read']);
        assert.equal((await value.call('read', { path: join(value.cwd, 'note.txt') })).isError, true);
        assert.equal(value.requests.length, 0);
      })
  },
  {
    name: '拒绝重复工具名和选择器语法',
    run: () =>
      usingFixture(async value => {
        const tool = value.sessionOptions.toolAccess.tools[0];
        for (const names of [['same', 'same'], ['*'], ['+read'], ['-read'], ['']]) {
          await assert.rejects(
            createHostSession({
              ...value.sessionOptions,
              toolAccess: {
                ...value.sessionOptions.toolAccess,
                tools: names.map(name => Object.assign({}, tool, { name }))
              }
            }),
            /工具名/
          );
        }
      })
  }
];
