import { mkdtemp, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import { createHostApplication } from '@chaptale/agent-host/application';
import { CreationApplication } from '@chaptale/creation/application';
import { openCreationStorage } from '@chaptale/storage';

interface ChatRequest {
  tools: { function: { name: string; parameters: { type?: string } } }[];
  messages: unknown[];
}

it('发往 OpenAI 兼容接口的工具参数顶层均为 object，作品工具随请求发送', async () => {
  const requests: ChatRequest[] = [];
  // 本地端点只记录请求并拒绝，不产生模型回复。
  const server = createServer((request, response) => {
    let body = '';
    request.on('data', chunk => (body += chunk));
    request.on('end', () => {
      requests.push(JSON.parse(body) as ChatRequest);
      response.writeHead(400, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ error: { message: '离线端点' } }));
    });
  });
  await new Promise<void>(done => server.listen(0, '127.0.0.1', done));
  const root = await mkdtemp(join(tmpdir(), 'chaptale-tool-request-'));
  const creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
  const host = await createHostApplication({
    cwd: join(root, 'work'),
    agentDir: join(root, 'agent'),
    configDir: join(root, 'config'),
    sessionDir: join(root, 'sessions'),
    settingsFile: join(root, 'config', 'settings.json'),
    creation
  });
  try {
    await host.execute({
      method: 'saveProvider',
      input: {
        id: 'offline-request',
        apiKey: 'offline-test-only',
        config: {
          baseUrl: `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`,
          api: 'openai-completions',
          models: [{ id: 'offline', name: '离线请求', contextWindow: 8192, maxTokens: 128 }]
        }
      }
    });
    const id = (await host.execute({
      method: 'create',
      input: { model: { provider: 'offline-request', id: 'offline' }, workId: null }
    })) as string;
    await host.execute({ method: 'prompt', input: { id, text: '列出作品' } }).catch(() => undefined);
    await expect.poll(() => requests.length).toBeGreaterThan(0);
    const tools = requests[0]!.tools.map(tool => tool.function);
    expect(tools.map(tool => tool.name)).toEqual(
      expect.arrayContaining(['work_ls', 'work_write', 'work_mv', 'work_edit', 'tool_search'])
    );
    // 事件与关系工具由 tool_search 按需加载，系统提示词给出可加载的工具名。
    expect(tools.map(tool => tool.name).filter(name => /^work_re(cord|lation)_/.test(name))).toEqual([]);
    expect(JSON.stringify(requests[0]!.messages)).toContain('work_relation_write');
    expect(tools.filter(tool => tool.parameters.type !== 'object').map(tool => tool.name)).toEqual([]);
  } finally {
    await host.dispose();
    creation.close();
    server.close();
    await rm(root, { recursive: true, force: true });
  }
});
