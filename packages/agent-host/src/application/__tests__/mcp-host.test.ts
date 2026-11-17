import {
  createAssistantMessageEventStream,
  getCurrentTools,
  InMemoryCredentialStore,
  type Context
} from '@earendil-works/pi-ai';
import { createReadToolDefinition, defineTool, ModelRuntime } from '@earendil-works/pi-coding-agent';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { ManagedMcpSnapshot } from '../../protocol.ts';
import { HostModelConfiguration } from '../../runtime/model-configuration.ts';
import { HostApplication } from '../index.ts';

const zeroUsage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
};

type ScriptTurn =
  | { kind: 'text'; text: string }
  | { kind: 'toolCall'; id: string; name: string; arguments: Record<string, string> };

const MCP_SERVER_SCRIPT = `
const readline = require('node:readline');
const tag = process.argv[2] || 'default';
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function send(msg) {
  process.stdout.write(JSON.stringify(msg) + '\\n');
}

rl.on('line', (line) => {
  if (!line.trim()) return;
  const msg = JSON.parse(line);
  if (msg.id === undefined) return;
  if (msg.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {}, resources: {} },
        serverInfo: { name: 'mcp-' + tag, version: '1.0.0' },
        instructions: 'Server tag: ' + tag
      }
    });
    return;
  }
  if (msg.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        tools: [
          {
            name: 'search',
            description: '检索词条',
            inputSchema: { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] }
          },
          {
            name: 'mutate',
            description: '更新外部词条',
            inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] }
          }
        ]
      }
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const toolName = msg.params.name;
    const args = msg.params.arguments || {};
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        content: [{ type: 'text', text: tag + ':' + toolName + ':' + JSON.stringify(args) }]
      }
    });
    return;
  }
  if (msg.method === 'resources/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        resources: [{ uri: tag + '://doc-1', name: tag + ' 文档', mimeType: 'text/plain' }]
      }
    });
    return;
  }
  if (msg.method === 'resources/read') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        contents: [{ uri: msg.params.uri, mimeType: 'text/plain', text: 'resource-from-' + tag }]
      }
    });
    return;
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
});
`;

describe('HostApplication MCP 接入', () => {
  let root: string;
  let scriptPath: string;
  let app: HostApplication;
  let contexts: Context[];
  let scriptQueue: ScriptTurn[];

  const modelRef = { provider: 'mcp-test', id: 'scripted-model' };

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-host-mcp-'));
    for (const sub of ['agent', 'sessions', 'cwd', 'data']) {
      await mkdir(join(root, sub), { recursive: true });
    }
    scriptPath = join(root, 'mcp-srv.cjs');
    await writeFile(scriptPath, MCP_SERVER_SCRIPT, 'utf8');
    contexts = [];
    scriptQueue = [];

    const runtime = await ModelRuntime.create({
      credentials: new InMemoryCredentialStore(),
      modelsPath: null,
      allowModelNetwork: false,
      refreshOnCreate: false
    });
    runtime.registerProvider(modelRef.provider, {
      baseUrl: 'http://127.0.0.1:9',
      apiKey: 'offline-key',
      api: 'mcp-scripted-api',
      models: [
        {
          id: modelRef.id,
          name: 'MCP 测试离线模型',
          reasoning: false,
          input: ['text'],
          contextWindow: 16384,
          maxTokens: 1024,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
        }
      ],
      streamSimple: (target, context) => {
        contexts.push(structuredClone(context));
        const step = scriptQueue.shift() ?? { kind: 'text', text: '完成' };
        const stream = createAssistantMessageEventStream();
        const content =
          step.kind === 'toolCall'
            ? [{ type: 'toolCall' as const, id: step.id, name: step.name, arguments: step.arguments }]
            : [{ type: 'text' as const, text: step.text }];
        const message = {
          role: 'assistant' as const,
          content,
          api: target.api,
          provider: target.provider,
          model: target.id,
          usage: zeroUsage,
          stopReason: step.kind === 'toolCall' ? ('toolUse' as const) : ('stop' as const),
          timestamp: Date.now()
        };
        queueMicrotask(() => {
          stream.push({ type: 'start', partial: message });
          stream.push({ type: 'done', reason: message.stopReason, message });
        });
        return stream;
      }
    });

    app = await HostApplication.create({
      cwd: join(root, 'cwd'),
      agentDir: join(root, 'agent'),
      sessionDir: join(root, 'sessions'),
      settingsFile: join(root, 'data', 'settings.json'),
      builtinInstructions: [{ name: '主创', role: 'system', text: '你是小说创作助手。', enabled: true }],
      modelRuntime: runtime,
      modelConfiguration: new HostModelConfiguration(join(root, 'data'), runtime),
      tools: cwd => [defineTool(createReadToolDefinition(cwd))]
    });
  });

  afterEach(async () => {
    await app.dispose();
    await rm(root, { recursive: true, force: true });
  });

  const server = (tag: string, extra: Record<string, unknown> = {}) => ({
    command: process.execPath,
    args: [scriptPath, tag],
    ...extra
  });

  async function saveGlobal(mcpServers: Record<string, unknown>): Promise<void> {
    const saved = (await app.execute({
      method: 'saveMcpConfig',
      input: { scope: 'global', workId: null, json: JSON.stringify({ mcpServers }) }
    })) as ManagedMcpSnapshot;
    expect(saved.globalErrors).toEqual([]);
    await expect
      .poll(async () => {
        const state = (await app.execute({ method: 'getMcpState', input: { workId: null } })) as ManagedMcpSnapshot;
        return state.servers.map(item => item.state);
      })
      .toEqual(Object.keys(mcpServers).map(() => 'connected'));
  }

  /** 这次请求声明给模型的工具。 */
  const declared = (context: Context) => getCurrentTools(context.messages).map(tool => tool.name);
  const view = (id: string) => app.snapshot().sessions.find(item => item.id === id)!;
  const transcript = (id: string) => JSON.stringify(view(id).messages);

  /** 发送一轮脚本并等到出现一条授权请求。 */
  async function promptUntilApproval(id: string, ...turns: ScriptTurn[]) {
    scriptQueue.push(...turns, { kind: 'text', text: '完成' });
    await app.execute({ method: 'prompt', input: { id, text: '继续' } });
    await expect.poll(() => app.snapshot().approvals.length).toBe(1);
    return app.snapshot().approvals[0]!;
  }

  async function waitIdle(id: string): Promise<void> {
    await expect.poll(() => view(id).running).toBe(false);
    expect(view(id).error).toBeUndefined();
  }

  const codemode = (id: string, code: string): ScriptTurn => ({
    kind: 'toolCall',
    id,
    name: 'codemode',
    arguments: { code }
  });

  it('讨论模式下 MCP 调用逐次授权：记住单个工具、记住整台服务、资源工具按目标服务求值、拒绝后不执行', async () => {
    await saveGlobal({ wiki: server('wiki-v1'), notes: server('notes-v1') });
    const id = (await app.execute({ method: 'create', input: { model: modelRef, workId: null } })) as string;
    await app.execute({ method: 'mode', input: { id, mode: 'discuss' } });

    // 脚本内的嵌套调用同样要作者授权；独立会话不提供作品级记住。
    const search = await promptUntilApproval(
      id,
      codemode('c1', 'return await tools.mcp__wiki__search({ q: "长安" });')
    );
    expect(search).toMatchObject({
      toolName: 'mcp__wiki__search',
      remember: { capability: 'mcp', serverScope: 'global', serverName: 'wiki', toolLabel: 'search', allowWork: false }
    });
    expect(transcript(id)).not.toContain('wiki-v1:search');
    await app.execute({
      method: 'approve',
      input: { id: search.id, allow: true, scope: 'session', mcpTarget: 'tool' }
    });
    await waitIdle(id);
    expect(transcript(id)).toContain('wiki-v1:search');
    expect(app.snapshot().settings.toolPermissions).toMatchObject([
      { scope: { kind: 'session' }, capability: 'mcp', serverName: 'wiki', toolName: 'search' }
    ]);

    // 记住的是 search，同一服务的 mutate 仍要询问；这次记住整台服务。
    const mutate = await promptUntilApproval(
      id,
      codemode(
        'c2',
        'const a = await tools.mcp__wiki__search({ q: "洛阳" }); const b = await tools.mcp__wiki__mutate({ title: "新词条" }); return [a, b];'
      )
    );
    expect(mutate.remember).toMatchObject({ serverName: 'wiki', toolLabel: 'mutate' });
    expect(transcript(id)).not.toContain('wiki-v1:mutate');
    await app.execute({
      method: 'approve',
      input: { id: mutate.id, allow: true, scope: 'session', mcpTarget: 'server' }
    });
    await waitIdle(id);
    expect(transcript(id)).toContain('wiki-v1:mutate');

    // 指定 wiki 的资源读取已被整台授权覆盖；不指定服务的列举还会访问 notes，拒绝后整次调用不执行。
    const listing = await promptUntilApproval(
      id,
      codemode('c3', 'return await tools.read_mcp_resource({ server: "wiki", uri: "wiki-v1://doc-1" });'),
      codemode('c4', 'return await tools.list_mcp_resources({});')
    );
    expect(listing.remember).toMatchObject({ serverName: 'notes', toolLabel: 'list_mcp_resources' });
    expect(transcript(id)).toContain('resource-from-wiki-v1');
    await app.execute({ method: 'approve', input: { id: listing.id, allow: false } });
    await waitIdle(id);
    expect(transcript(id)).not.toContain('notes-v1 文档');
    expect(transcript(id)).not.toContain('wiki-v1 文档');
  }, 30_000);

  it('保存配置后已打开的会话换用新连接：改为 direct 的工具直接声明给模型，命令变化使旧授权失效', async () => {
    await saveGlobal({ wiki: server('wiki-v1') });
    const id = (await app.execute({ method: 'create', input: { model: modelRef, workId: null } })) as string;
    const first = await promptUntilApproval(id, codemode('c1', 'return await tools.mcp__wiki__search({ q: "长安" });'));
    await app.execute({
      method: 'approve',
      input: { id: first.id, allow: true, scope: 'session', mcpTarget: 'server' }
    });
    await waitIdle(id);
    expect(declared(contexts[0]!)).not.toContain('mcp__wiki__search');

    await saveGlobal({ wiki: server('wiki-v2', { exposure: 'direct' }) });
    await expect.poll(() => app.liveSession(id)!.getActiveToolNames()).toContain('mcp__wiki__search');

    const requests = contexts.length;
    const again = await promptUntilApproval(id, {
      kind: 'toolCall',
      id: 'c2',
      name: 'mcp__wiki__search',
      arguments: { q: '大明宫' }
    });
    expect(declared(contexts[requests]!)).toContain('mcp__wiki__search');
    expect(again.toolName).toBe('mcp__wiki__search');
    await app.execute({ method: 'approve', input: { id: again.id, allow: true } });
    await waitIdle(id);
    expect(transcript(id)).toContain('wiki-v2:search');

    // 停用后工具从会话撤下，模型仍调用时不执行。
    await app.execute({
      method: 'patchMcpServer',
      input: { targetScope: 'global', workId: null, name: 'wiki', enabled: false }
    });
    await expect.poll(() => app.liveSession(id)!.getActiveToolNames()).not.toContain('mcp__wiki__search');
    scriptQueue.push(
      { kind: 'toolCall', id: 'c3', name: 'mcp__wiki__search', arguments: { q: '停用后' } },
      { kind: 'text', text: '完成' }
    );
    await app.execute({ method: 'prompt', input: { id, text: '继续' } });
    await waitIdle(id);
    expect(app.snapshot().approvals).toEqual([]);
    expect(view(id).messages.find(message => message.toolCallId === 'c3')).toMatchObject({ error: true });
    expect(transcript(id)).not.toContain('wiki-v2:search:{\\"q\\":\\"停用后');
  }, 30_000);
});
