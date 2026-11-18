import { runToolCall } from '@earendil-works/pi-agent-core';
import { type ToolDefinition } from '@earendil-works/pi-coding-agent';
import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, expect } from 'vitest';

import {
  builtinWritingInstructions,
  createHostModelRuntime,
  EmbeddingConfiguration,
  HostModelConfiguration
} from '@chaptale/agent-host';
import { createHostApplication, HostApplication } from '@chaptale/agent-host/application';
import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, EntrySnapshot } from '@chaptale/creation/contracts';
import { openCreationStorage } from '@chaptale/storage';

export let root: string;
export let creation: CreationApplication;
export let host: HostApplication;
export let id: string;
export let workId: string;
export let documentId: string;
export let revisionId: string;
export function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
// 固定工具协议输入写入 SDK 公共消息状态，供嵌套调用定位发起者；不请求模型。
export function call(
  name: string,
  input: Parameters<typeof runToolCall>[0]['arguments'],
  toolCallId = randomUUID(),
  signal?: AbortSignal,
  sessionId = id
) {
  const session = host.liveSession(sessionId)!;
  const assistant = {
    role: 'assistant' as const,
    content: [{ type: 'toolCall' as const, id: toolCallId, name, arguments: input }],
    api: 'openai-completions',
    provider: 'offline-tools',
    model: 'offline',
    stopReason: 'toolUse' as const,
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
  session.agent.state.messages = [...session.agent.state.messages, assistant];
  return runToolCall(assistant.content[0], {
    assistantMessage: assistant,
    context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
    tools: session.agent.state.tools,
    beforeToolCall: session.agent.beforeToolCall,
    afterToolCall: session.agent.afterToolCall,
    signal
  });
}
export async function restartWithTools(tools: ToolDefinition[], history?: { file: string }) {
  await host.dispose();
  const configDir = join(root, 'config');
  const runtime = await createHostModelRuntime({ configDir });
  host = await HostApplication.create({
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(configDir, 'settings.json'),
    builtinInstructions: builtinWritingInstructions,
    modelRuntime: runtime,
    modelConfiguration: new HostModelConfiguration(configDir, runtime),
    embeddingConfiguration: new EmbeddingConfiguration(configDir),
    creation,
    tools: () => tools
  });
  id = (await host.execute(
    history
      ? { method: 'open', input: history }
      : {
          method: 'create',
          input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
        }
  )) as string;
  return runtime;
}
// 事件与关系工具由 tool_search 按需加载；pi 让延迟工具始终可经嵌套调用，讨论模式由宿主授权拒绝写入。
export const deferredTools = ['work_record_ls', 'work_record_write', 'work_relation_ls', 'work_relation_write'];
export async function load(query: string, sessionId = id) {
  const outcome = await call('tool_search', { query }, randomUUID(), undefined, sessionId);
  expect(outcome.isError, JSON.stringify(outcome.result)).toBe(false);
}
export function read() {
  return value(creation.executeAuthor({ method: 'readDocument', input: { workId, documentId } }));
}
export function pending(sessionId = id) {
  return value(creation.executeAuthor({ method: 'listPendingChanges', input: { workId, sessionId } }));
}
/** 把当前会话换成归属作品的新会话，会话历史写在作品的会话目录。 */
export async function ownSession() {
  await host.execute({ method: 'close', input: { id } });
  id = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId }
  })) as string;
}
export async function observeRequests(runtime: Awaited<ReturnType<typeof restartWithTools>>) {
  const requests: Array<{ messages: string; tools: string[] }> = [];
  runtime.registerProvider('offline-tools', {
    baseUrl: 'http://127.0.0.1:9',
    apiKey: 'offline-test-only',
    api: 'offline-review-results',
    models: [
      {
        id: 'offline',
        name: '离线请求观察',
        contextWindow: 8192,
        maxTokens: 128,
        reasoning: false,
        input: ['text'],
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
      }
    ],
    // 在传输边界观察请求后结束；不联网、不生成模型回复。
    streamSimple: (_model, context) => {
      requests.push({
        messages: JSON.stringify(context.messages),
        tools: context.messages.flatMap(message =>
          message.role === 'system' ? (message.toolsAdded ?? []).map(tool => tool.name) : []
        )
      });
      throw new Error('离线传输检查结束');
    }
  });
  await host.execute({ method: 'model', input: { id, model: { provider: 'offline-tools', id: 'offline' } } });
  return requests;
}
export function decidePending(decision: 'accept' | 'reject', changeId = pending()[0].id) {
  const review = value(creation.executeAuthor({ method: 'readReview', input: { changeId } }));
  const command = {
    method: 'decideReview' as const,
    input: {
      commandId: randomUUID(),
      changeId,
      expectedVersion: review.change.version,
      expectedRevisionId: review.current?.revisionId ?? null,
      expectedLocation:
        review.change.target === 'entry' && review.current
          ? {
              parentId: (review.current as EntrySnapshot).parentId,
              position: (review.current as EntrySnapshot).position
            }
          : null,
      decision
    }
  };
  value(creation.executeAuthor(command));
  return command;
}
// 将公共工具管线的真实结果交给 SDK 原生回合边界；固定协议夹具不生成模型回复。
export async function finishToolTurn(outcome: Awaited<ReturnType<typeof call>>) {
  const session = host.liveSession(id)!;
  const message = session.agent.state.messages.at(-1)!;
  if (message.role !== 'assistant') throw new Error('工具协议夹具缺少 assistant 消息');
  const result = {
    role: 'toolResult' as const,
    toolCallId: outcome.toolCall.id,
    toolName: outcome.toolCall.name,
    content: outcome.result.content,
    details: outcome.result.details,
    structuredContent: outcome.result.structuredContent,
    isError: outcome.isError,
    timestamp: Date.now()
  };
  session.sessionManager.appendMessage(message);
  session.sessionManager.appendMessage(result);
  session.agent.state.messages = [...session.agent.state.messages, result];
  return session.agent.finishTurn!({
    message,
    toolResults: [result],
    context: { messages: session.agent.state.messages, tools: session.agent.state.tools },
    newMessages: [message, result]
  });
}
export function structured(outcome: Awaited<ReturnType<typeof call>>) {
  const details = outcome.result.details as CreationResult<Record<string, unknown>>;
  if (details.ok) expect(outcome.result.structuredContent).toEqual(details.value);
  else expect(outcome.result.structuredContent).toBeUndefined();
  return details;
}
export async function createResource(title: string) {
  const outcome = await call('work_write', {
    workId,
    parentId: null,
    title,
    section: 'resource',
    format: 'markdown',
    content: ''
  });
  return (value(structured(outcome)).entry as { entryId: string }).entryId;
}
/** 用例切换到另一个会话后，后续的工具调用都发给它。 */
export function useSession(sessionId: string) {
  id = sessionId;
}

/** 每个用例使用独立的临时目录与宿主；在测试文件顶层调用一次。 */
export function setupWorkSession() {
  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-creation-tools-'));
    creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
    host = await createHostApplication({
      cwd: join(root, 'work'),
      agentDir: join(root, 'agent'),
      configDir: join(root, 'config'),
      sessionDir: join(root, 'sessions'),
      settingsFile: join(root, 'config', 'settings.json'),
      creation
    });
    await host.execute({
      method: 'saveProvider',
      input: {
        id: 'offline-tools',
        apiKey: 'offline-test-only',
        config: {
          baseUrl: 'http://127.0.0.1:9',
          api: 'openai-completions',
          models: [{ id: 'offline', name: '离线工具测试', contextWindow: 8192, maxTokens: 128 }]
        }
      }
    });
    id = (await host.execute({
      method: 'create',
      input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
    })) as string;
    workId = value(
      creation.executeAuthor({
        method: 'createWork',
        input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' }
      })
    ).id;
    const document = value(
      creation.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title: '序章',
          format: 'txt',
          content: '将军守城。\n城外下雪。\n斥候回营。'
        }
      })
    );
    documentId = document.id;
    revisionId = document.revisionId;
  });
  afterEach(async () => {
    await host?.dispose();
    creation?.close();
    await rm(root, { recursive: true, force: true });
  });
}
