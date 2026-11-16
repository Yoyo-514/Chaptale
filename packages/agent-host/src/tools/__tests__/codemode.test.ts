import { runToolCall } from '@earendil-works/pi-agent-core';
import { InMemoryCredentialStore, type AssistantMessage } from '@earendil-works/pi-ai';
import { defineTool, ModelRuntime, SessionManager } from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import { Type } from 'typebox';
import { describe, expect, it } from 'vitest';

import { sessionHistory } from '../../application/history.ts';
import {
  createHostSession,
  defaultCodemodeTimeoutMs,
  maxCodemodeTimeoutMs,
  openHostSessionManager,
  type HostToolAuthorizer,
  type HostToolDecision,
  type HostToolRequest
} from '../../index.ts';
import { instructionsEntryType, modeEntryType } from '../../protocol.ts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => {
    resolve = done;
  });
  return { promise, resolve };
}

function scriptJson(result: { content: Array<{ type: string; text?: string }> }): unknown {
  const output = textOf(result);
  const marker = 'Output:\n\n';
  const index = output.indexOf(marker);
  if (index === -1) throw new Error(`Missing Output marker in: ${output}`);
  return JSON.parse(output.slice(index + marker.length).trim());
}

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content
    .filter(block => block.type === 'text')
    .map(block => block.text ?? '')
    .join('\n');
}

async function createCodemodeFixture(
  options: {
    authorize?: HostToolAuthorizer;
    codemode?: { defaultTimeoutMs?: number; maxTimeoutMs?: number };
    persistent?: boolean;
    noTools?: boolean;
  } = {}
) {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-codemode-'));
  const cwd = join(root, 'work');
  const agentDir = join(root, 'agent');
  const sessionDir = join(root, 'sessions');
  await mkdir(cwd);
  await mkdir(agentDir);
  await mkdir(sessionDir);
  await writeFile(join(cwd, 'a.txt'), '第一篇');
  await writeFile(join(cwd, 'b.txt'), '第二篇');

  const requests: HostToolRequest[] = [];
  let executions = 0;

  const readItem = defineTool({
    name: 'read_item',
    label: '读取文件',
    description: '读取工作目录文件。',
    parameters: Type.Object({ name: Type.String() }),
    outputSchema: Type.Object({ name: Type.String(), content: Type.String() }),
    async execute(_id, args, signal) {
      signal?.throwIfAborted();
      executions++;
      const content = await readFile(join(cwd, args.name), 'utf8');
      return {
        content: [{ type: 'text' as const, text: content }],
        structuredContent: { name: args.name, content },
        details: undefined
      };
    }
  });

  const hiddenRecord = defineTool({
    name: 'deferred_tag',
    label: '延迟标签',
    description: '按需调用的延迟工具。',
    exposure: 'deferred',
    parameters: Type.Object({ label: Type.String() }),
    outputSchema: Type.Object({ tagged: Type.String() }),
    async execute(_id, args) {
      executions++;
      return {
        content: [{ type: 'text' as const, text: args.label }],
        structuredContent: { tagged: `已标记:${args.label}` },
        details: undefined
      };
    }
  });

  const modelRuntime = await ModelRuntime.create({
    credentials: new InMemoryCredentialStore(),
    modelsPath: null,
    refreshOnCreate: false,
    allowModelNetwork: false
  });

  const sessionManager = options.persistent ? SessionManager.create(cwd, sessionDir) : SessionManager.inMemory(cwd);
  if (options.persistent) {
    sessionManager.appendCustomEntry(instructionsEntryType, {
      entries: [{ name: '默认', role: 'system', enabled: true, text: '测试指令' }]
    });
    sessionManager.appendCustomEntry(modeEntryType, { mode: 'review' });
  }

  const makeToolAccess = () =>
    options.noTools
      ? { tools: [], authorize: async () => ({ allow: true as const }) }
      : {
          tools: [readItem, hiddenRecord],
          codemode: options.codemode,
          authorize: async (request: HostToolRequest, signal: AbortSignal | undefined): Promise<HostToolDecision> => {
            requests.push(request);
            return options.authorize ? options.authorize(request, signal) : { allow: true };
          }
        };

  const { session } = await createHostSession({
    cwd,
    agentDir,
    sessionManager,
    systemPrompt: 'Code Mode 边界离线验证。',
    modelRuntime,
    toolAccess: makeToolAccess()
  });

  let sequence = 0;
  function runScript(TargetSession: typeof session, code: string, signal?: AbortSignal) {
    const assistant: AssistantMessage = {
      role: 'assistant',
      content: [{ type: 'toolCall', id: `cm-${++sequence}`, name: 'codemode', arguments: { code } }],
      api: 'openai-responses',
      provider: 'offline',
      model: 'codemode-fixture',
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
    TargetSession.sessionManager.appendMessage(assistant);
    TargetSession.agent.state.messages = [...TargetSession.agent.state.messages, assistant];
    return runToolCall(assistant.content[0] as Extract<AssistantMessage['content'][number], { type: 'toolCall' }>, {
      assistantMessage: assistant,
      context: { messages: TargetSession.agent.state.messages, tools: TargetSession.agent.state.tools },
      tools: TargetSession.agent.state.tools,
      beforeToolCall: TargetSession.agent.beforeToolCall,
      afterToolCall: TargetSession.agent.afterToolCall,
      signal
    });
  }

  return {
    root,
    cwd,
    agentDir,
    session,
    sessionManager,
    modelRuntime,
    requests,
    makeToolAccess,
    get executions() {
      return executions;
    },
    run: (code: string, signal?: AbortSignal) => runScript(session, code, signal),
    runOn: runScript,
    async dispose() {
      await session.abort();
      session.dispose();
      await rm(root, { recursive: true, force: true });
    }
  };
}

describe('pi 原生 Code Mode 宿主接入', () => {
  it('暴露约定的默认与最大超时常量，无业务工具时不激活空 codemode', async () => {
    expect(defaultCodemodeTimeoutMs).toBe(120_000);
    expect(maxCodemodeTimeoutMs).toBe(300_000);

    const empty = await createCodemodeFixture({ noTools: true });
    try {
      expect(empty.session.getActiveToolNames()).toEqual([]);
    } finally {
      await empty.dispose();
    }
  });

  it('关闭 models 全局接口，嵌套调用逐条经过宿主授权且拒绝时不执行目标工具', async () => {
    const fixture = await createCodemodeFixture({
      authorize: async request =>
        (request.input as { name?: string }).name === 'b.txt'
          ? { allow: false, reason: '目录外文件已拒绝' }
          : { allow: true }
    });
    try {
      expect(fixture.session.getActiveToolNames()).toContain('codemode');
      const codemodeTool = fixture.session.agent.state.tools.find(tool => tool.name === 'codemode')!;
      expect(codemodeTool.description).not.toContain('codemode.md');

      const outcome = await fixture.run(`
        const first = await tools.read_item({ name: 'a.txt' });
        let secondError = '';
        try {
          await tools.read_item({ name: 'b.txt' });
        } catch (err) {
          secondError = err.message;
        }
        const found = await searchTools('deferred_tag');
        const tagged = await tools.deferred_tag({ label: first.content });
        return {
          hasModels: typeof models !== 'undefined',
          first,
          secondError,
          foundNames: found.map(item => item.name),
          tagged
        };
      `);

      expect(outcome.isError, textOf(outcome.result)).toBe(false);
      expect(scriptJson(outcome.result)).toEqual({
        hasModels: false,
        first: { name: 'a.txt', content: '第一篇' },
        secondError: '目录外文件已拒绝',
        foundNames: ['deferred_tag'],
        tagged: { tagged: '已标记:第一篇' }
      });
      // 父工具 codemode 本身不走外部文件授权弹窗，三次子调用逐条鉴权，b.txt 未执行。
      expect(fixture.requests.map(item => item.toolName)).toEqual(['read_item', 'read_item', 'deferred_tag']);
      expect(fixture.executions).toBe(2);
    } finally {
      await fixture.dispose();
    }
  });

  it('未声明 timeout_ms 时应用默认超时，超限 timeout_ms 钳制到上限，保留其他合法 @options', async () => {
    const fixture = await createCodemodeFixture({
      codemode: { defaultTimeoutMs: 120, maxTimeoutMs: 180 }
    });
    try {
      const noHeaderSpin = await fixture.run('while (true) {}');
      expect(noHeaderSpin.isError).toBe(true);
      expect(textOf(noHeaderSpin.result)).toMatch(/timed out/i);

      const clampedSpin = await fixture.run(
        '// @options: {"max_output_tokens": 500, "timeout_ms": 999999}\nwhile (true) {}'
      );
      expect(clampedSpin.isError).toBe(true);
      expect(textOf(clampedSpin.result)).toMatch(/timed out/i);

      const invalidHeader = await fixture.run('// @options: {"unknown_field": 1}\nreturn 1;');
      expect(invalidHeader.isError).toBe(true);
      expect(textOf(invalidHeader.result)).toContain('unknown_field');
    } finally {
      await fixture.dispose();
    }
  });

  it('脚本挂起等待子工具授权时取消信号立即终止 Worker，迟到批准不执行工具', async () => {
    const entered = deferred<void>();
    const decision = deferred<HostToolDecision>();
    const fixture = await createCodemodeFixture({
      authorize: async () => {
        entered.resolve();
        return decision.promise;
      }
    });
    try {
      const controller = new AbortController();
      const running = fixture.run(`return await tools.read_item({ name: 'a.txt' });`, controller.signal);
      await entered.promise;
      controller.abort();
      const outcome = await running;
      expect(outcome.isError).toBe(true);

      decision.resolve({ allow: true });
      await setImmediate();
      expect(fixture.executions).toBe(0);
    } finally {
      await fixture.dispose();
    }
  });

  it('store/load 在持久会话重开后继续可用且兼容历史检查', async () => {
    const fixture = await createCodemodeFixture({ persistent: true });
    try {
      const first = await fixture.run(`
        store('extracted', { count: 2, names: ['陆沉', '苏晚'] });
        return load('extracted');
      `);
      expect(first.isError, textOf(first.result)).toBe(false);
      const file = fixture.sessionManager.getSessionFile()!;
      await fixture.session.abort();
      fixture.session.dispose();

      const reopenedManager = await openHostSessionManager({ file, cwd: async () => fixture.cwd });
      const history = sessionHistory(reopenedManager);
      expect(history.kind).toBe('live');

      const reopened = await createHostSession({
        cwd: fixture.cwd,
        agentDir: fixture.agentDir,
        sessionManager: reopenedManager,
        systemPrompt: 'Code Mode 重开验证。',
        modelRuntime: fixture.modelRuntime,
        toolAccess: fixture.makeToolAccess()
      });
      try {
        const second = await fixture.runOn(reopened.session, `return load('extracted');`);
        expect(second.isError, textOf(second.result)).toBe(false);
        expect(scriptJson(second.result)).toEqual({ count: 2, names: ['陆沉', '苏晚'] });
      } finally {
        await reopened.session.abort();
        reopened.session.dispose();
      }
    } finally {
      await rm(fixture.root, { recursive: true, force: true });
    }
  });
});
