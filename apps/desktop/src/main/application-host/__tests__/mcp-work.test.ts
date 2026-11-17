import { randomUUID } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHostApplication, type HostApplication } from '@chaptale/agent-host/application';
import type { ManagedMcpSnapshot } from '@chaptale/agent-host/protocol';
import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';
import { openCreationStorage } from '@chaptale/storage';

/** 最小 stdio MCP 服务：工具说明里带上自己的进程号，供测试确认进程是否还在。 */
const MCP_SERVER_SCRIPT = `
const readline = require('node:readline');
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
const send = message => process.stdout.write(JSON.stringify(message) + '\\n');
rl.on('line', line => {
  if (!line.trim()) return;
  const message = JSON.parse(line);
  if (message.id === undefined) return;
  if (message.method === 'initialize') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        protocolVersion: '2025-03-26',
        capabilities: { tools: {} },
        serverInfo: { name: 'fixture', version: '1.0.0' }
      }
    });
  } else if (message.method === 'tools/list') {
    send({
      jsonrpc: '2.0',
      id: message.id,
      result: {
        tools: [{ name: 'whoami', description: String(process.pid), inputSchema: { type: 'object', properties: {} } }]
      }
    });
  } else {
    send({ jsonrpc: '2.0', id: message.id, error: { code: -32601, message: 'Method not found' } });
  }
});
`;

function unwrap<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

describe('作品级 MCP 配置与作品生命周期', () => {
  let root: string;
  let creation: CreationApplication;
  let host: HostApplication;

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'chaptale-work-mcp-'));
    creation = new CreationApplication(await openCreationStorage({ rootDir: join(root, 'creation') }));
    host = await createHostApplication({
      cwd: join(root, 'work'),
      agentDir: join(root, 'agent'),
      configDir: join(root, 'config'),
      sessionDir: join(root, 'sessions'),
      settingsFile: join(root, 'config', 'settings.json'),
      creation
    });
  });

  afterEach(async () => {
    await host.dispose();
    creation.close();
    await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  });

  it('作品的 mcp.json 只对这部作品生效，移入回收站时结束它的服务进程，恢复后重新连接', async () => {
    const script = join(root, 'server.cjs');
    await writeFile(script, MCP_SERVER_SCRIPT, 'utf8');
    const json = (name: string) =>
      JSON.stringify({ mcpServers: { [name]: { command: process.execPath, args: [script] } } });
    const createWork = (title: string) =>
      unwrap(
        creation.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title, kind: 'novel' } })
      );
    const workA = createWork('甲书');
    const workB = createWork('乙书');

    const state = async (workId: string | null) =>
      (await host.execute({ method: 'getMcpState', input: { workId } })) as ManagedMcpSnapshot;
    /** 等到这一层看到的服务全部连接，返回服务名到进程号的对照。 */
    const connected = async (workId: string | null, names: string[]) => {
      await expect
        .poll(
          async () =>
            (await state(workId)).servers
              .map(server => `${server.name}:${server.definedIn}:${server.state}`)
              .toSorted(),
          { timeout: 15_000 }
        )
        .toEqual(names.map(name => `${name}:connected`).toSorted());
      return new Map((await state(workId)).servers.map(server => [server.name, Number(server.tools[0]!.description)]));
    };

    await host.execute({ method: 'saveMcpConfig', input: { scope: 'global', workId: null, json: json('wiki') } });
    await host.execute({ method: 'saveMcpConfig', input: { scope: 'work', workId: workA.id, json: json('notes') } });
    await expect(
      host.execute({ method: 'saveMcpConfig', input: { scope: 'work', workId: null, json: json('notes') } })
    ).rejects.toThrow('目标作品不存在');

    const before = await connected(workA.id, ['wiki:global', 'notes:work']);
    await connected(workB.id, ['wiki:global']);
    await connected(null, ['wiki:global']);
    expect(alive(before.get('notes')!)).toBe(true);

    // 移入回收站：作品自己的服务进程结束，全局服务继续运行
    await host.execute({ method: 'trashWork', input: { commandId: randomUUID(), workId: workA.id } });
    await expect.poll(() => alive(before.get('notes')!), { timeout: 15_000 }).toBe(false);
    expect(alive(before.get('wiki')!)).toBe(true);

    // 恢复后配置仍在，查看状态时重新启动服务
    unwrap(creation.executeAuthor({ method: 'restoreWork', input: { commandId: randomUUID(), workId: workA.id } }));
    const after = await connected(workA.id, ['wiki:global', 'notes:work']);
    expect(after.get('notes')).not.toBe(before.get('notes'));
    expect(after.get('wiki')).toBe(before.get('wiki'));
  }, 30_000);
});
