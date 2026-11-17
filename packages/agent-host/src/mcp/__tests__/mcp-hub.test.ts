import { McpClient } from '@earendil-works/pi-mcp';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { globalMcpConfigFile, saveValidatedMcpConfig, workMcpConfigFile } from '../config.ts';
import { HostMcpService } from '../service.ts';

/** 构造真实运行的极简 Node stdio MCP 测试服务脚本，报告自身 PID 与 cwd，并支持慢调用中断测试。 */
const STDIO_FIXTURE_SCRIPT = `
const readline = require('node:readline');
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
        capabilities: { tools: { listChanged: true }, resources: {} },
        serverInfo: { name: 'stdio-fixture', version: '1.0.0' }
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
            name: 'inspect_proc',
            description: '返回当前服务进程 PID 与工作目录',
            inputSchema: { type: 'object', properties: {} }
          },
          {
            name: 'slow_op',
            description: '模拟长耗时调用',
            inputSchema: { type: 'object', properties: { ms: { type: 'number' } } }
          }
        ]
      }
    });
    return;
  }
  if (msg.method === 'tools/call') {
    const name = msg.params && msg.params.name;
    if (name === 'inspect_proc') {
      send({
        jsonrpc: '2.0',
        id: msg.id,
        result: {
          content: [{ type: 'text', text: JSON.stringify({ pid: process.pid, cwd: process.cwd() }) }]
        }
      });
      return;
    }
    if (name === 'slow_op') {
      const ms = (msg.params && msg.params.arguments && msg.params.arguments.ms) || 10000;
      setTimeout(() => {
        send({
          jsonrpc: '2.0',
          id: msg.id,
          result: { content: [{ type: 'text', text: 'done' }] }
        });
      }, ms);
      return;
    }
  }
  if (msg.method === 'resources/list') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        resources: [{ uri: 'lore://chapter-1', name: '第一章大纲', mimeType: 'text/plain' }]
      }
    });
    return;
  }
  if (msg.method === 'resources/read') {
    send({
      jsonrpc: '2.0',
      id: msg.id,
      result: {
        contents: [{ uri: msg.params.uri, mimeType: 'text/plain', text: '长安雪夜，灯火通明。' }]
      }
    });
    return;
  }
  send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
});
`;

interface LocalOAuthMcpServer {
  mcpUrl: string;
  close(): Promise<void>;
}

async function startLocalOAuthMcpServer(): Promise<LocalOAuthMcpServer> {
  const validTokens = new Set<string>();
  const authCodes = new Map<string, { codeChallenge: string; redirectUri: string; clientId: string }>();
  let baseUrl = '';

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? '/', baseUrl);

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-protected-resource') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          resource: `${baseUrl}/mcp`,
          authorization_servers: [baseUrl]
        })
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/.well-known/oauth-authorization-server') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          issuer: baseUrl,
          authorization_endpoint: `${baseUrl}/authorize`,
          token_endpoint: `${baseUrl}/token`,
          registration_endpoint: `${baseUrl}/register`,
          response_types_supported: ['code'],
          grant_types_supported: ['authorization_code', 'refresh_token'],
          code_challenge_methods_supported: ['S256'],
          token_endpoint_auth_methods_supported: ['none']
        })
      );
      return;
    }

    if (req.method === 'POST' && url.pathname === '/register') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { redirect_uris?: string[] };
      res.writeHead(201, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          client_id: 'test-dynamic-client',
          redirect_uris: body.redirect_uris ?? [],
          token_endpoint_auth_method: 'none'
        })
      );
      return;
    }

    if (req.method === 'GET' && url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri')!;
      const state = url.searchParams.get('state')!;
      const codeChallenge = url.searchParams.get('code_challenge')!;
      const clientId = url.searchParams.get('client_id')!;
      const code = `code-${Math.random().toString(36).slice(2)}`;
      authCodes.set(code, { codeChallenge, redirectUri, clientId });
      const redirect = new URL(redirectUri);
      redirect.searchParams.set('code', code);
      redirect.searchParams.set('state', state);
      res.writeHead(302, { location: redirect.toString() });
      res.end();
      return;
    }

    if (req.method === 'POST' && url.pathname === '/token') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const params = new URLSearchParams(Buffer.concat(chunks).toString('utf8'));
      const code = params.get('code') ?? '';
      const verifier = params.get('code_verifier') ?? '';
      const record = authCodes.get(code);
      if (!record) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      authCodes.delete(code);
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (challenge !== record.codeChallenge) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: 'invalid_grant' }));
        return;
      }
      const accessToken = `tok-${Math.random().toString(36).slice(2)}`;
      validTokens.add(accessToken);
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          access_token: accessToken,
          token_type: 'Bearer',
          expires_in: 3600
        })
      );
      return;
    }

    if (url.pathname === '/mcp') {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
      if (!validTokens.has(token)) {
        res.writeHead(401, {
          'www-authenticate': `Bearer resource_metadata="${baseUrl}/.well-known/oauth-protected-resource"`,
          'content-type': 'application/json'
        });
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      if (req.method === 'GET' || req.method === 'DELETE') {
        res.writeHead(405).end();
        return;
      }
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(chunk as Buffer);
      const rpc = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
        id?: number | string;
        method: string;
      };
      if (rpc.id === undefined) {
        res.writeHead(202).end();
        return;
      }
      if (rpc.method === 'initialize') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              protocolVersion: '2025-03-26',
              capabilities: { tools: {} },
              serverInfo: { name: 'oauth-mcp', version: '1.0.0' }
            }
          })
        );
        return;
      }
      if (rpc.method === 'tools/list') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: {
              tools: [{ name: 'whoami', description: '校验登录态', inputSchema: { type: 'object', properties: {} } }]
            }
          })
        );
        return;
      }
      if (rpc.method === 'tools/call') {
        res.writeHead(200, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({
            jsonrpc: '2.0',
            id: rpc.id,
            result: { content: [{ type: 'text', text: 'authenticated-author' }] }
          })
        );
        return;
      }
    }

    res.writeHead(404).end();
  });

  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const addr = server.address();
  if (!addr || typeof addr === 'string') throw new Error('Failed to bind local OAuth MCP server');
  baseUrl = `http://127.0.0.1:${addr.port}`;

  return {
    mcpUrl: `${baseUrl}/mcp`,
    close: () => new Promise<void>((resolve, reject) => server.close(err => (err ? reject(err) : resolve())))
  };
}

async function waitFor<T>(fn: () => Promise<T> | T, predicate: (val: T) => boolean, timeoutMs = 5000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let last!: T;
  while (Date.now() < deadline) {
    last = await fn();
    if (predicate(last)) return last;
    await new Promise(resolve => setTimeout(resolve, 40));
  }
  return last;
}

describe('HostMcpService 进程级连接共享、即时断连与 OAuth 2.1 登录', () => {
  const dirs: string[] = [];
  const cleanups: (() => Promise<void>)[] = [];

  afterEach(async () => {
    for (const cleanup of cleanups.splice(0).reverse()) {
      await cleanup();
    }
    await Promise.all(dirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
  });

  async function setupFixture() {
    const root = await mkdtemp(join(tmpdir(), 'chaptale-mcp-hub-'));
    dirs.push(root);
    const agentDir = join(root, 'agent');
    const globalCwd = join(root, 'empty-cwd');
    const workFilesDir = join(root, 'works', 'w1', 'files');
    await mkdir(agentDir, { recursive: true });
    await mkdir(globalCwd, { recursive: true });
    await mkdir(workFilesDir, { recursive: true });
    const scriptPath = join(root, 'stdio-fixture.cjs');
    await writeFile(scriptPath, STDIO_FIXTURE_SCRIPT, 'utf8');
    return {
      root,
      agentDir,
      globalCwd: await realpath(globalCwd),
      workFilesDir: await realpath(workFilesDir),
      scriptPath
    };
  }

  it('无打开会话时可展示服务工具与资源，多虚拟会话复用同一 stdio 子进程 PID，停用立即中断在途调用', async () => {
    const fx = await setupFixture();
    await saveValidatedMcpConfig(
      globalMcpConfigFile(fx.agentDir),
      'global',
      JSON.stringify({
        mcpServers: {
          global_srv: { command: process.execPath, args: [fx.scriptPath] }
        }
      })
    );
    await saveValidatedMcpConfig(
      workMcpConfigFile(fx.workFilesDir),
      'work',
      JSON.stringify({
        mcpServers: {
          work_srv: { command: process.execPath, args: [fx.scriptPath] }
        }
      })
    );

    const service = new HostMcpService({
      agentDir: fx.agentDir,
      defaultGlobalCwd: fx.globalCwd,
      resolveWorkFilesDir: workId => (workId === 'w1' ? fx.workFilesDir : null)
    });
    cleanups.push(() => service.close());

    // 即使没有任何聊天会话打开，设置页读取状态也能触发共享连接并看到已发现工具与资源标记
    const snap = await waitFor(
      () => service.getSnapshot('w1'),
      s => s.servers.length === 2 && s.servers.every(srv => srv.state === 'connected')
    );
    const workView = snap.servers.find(s => s.name === 'work_srv')!;
    expect(workView.state).toBe('connected');
    expect(workView.hasResources).toBe(true);
    expect(workView.tools.map(t => t.name)).toEqual(['inspect_proc', 'slow_op']);

    // 两个独立会话通过虚拟传输连接同一作品服务，底层只启动 1 个子进程且默认 cwd 指向作品 files 目录
    const clientA = new McpClient({ name: 'session-a', version: '1.0.0' });
    const clientB = new McpClient({ name: 'session-b', version: '1.0.0' });
    cleanups.push(
      () => clientA.close(),
      () => clientB.close()
    );

    await clientA.connect(await service.createSessionTransport('w1', 'work_srv'));
    await clientB.connect(await service.createSessionTransport('w1', 'work_srv'));

    const resA = await clientA.callTool('inspect_proc', {});
    const resB = await clientB.callTool('inspect_proc', {});
    const infoA = JSON.parse((resA.content[0] as { text: string }).text) as { pid: number; cwd: string };
    const infoB = JSON.parse((resB.content[0] as { text: string }).text) as { pid: number; cwd: string };
    expect(infoA.pid).toBe(infoB.pid);
    expect(await realpath(infoA.cwd)).toBe(fx.workFilesDir);

    // 全局服务默认 cwd 指向应用空目录
    const clientGlobal = new McpClient({ name: 'session-g', version: '1.0.0' });
    cleanups.push(() => clientGlobal.close());
    await clientGlobal.connect(await service.createSessionTransport(null, 'global_srv'));
    const resG = await clientGlobal.callTool('inspect_proc', {});
    const infoG = JSON.parse((resG.content[0] as { text: string }).text) as { pid: number; cwd: string };
    expect(infoG.pid).not.toBe(infoA.pid);
    expect(await realpath(infoG.cwd)).toBe(fx.globalCwd);

    // 发起慢调用期间停用服务，底层连接立即断开并拒绝在途请求
    const slowOutcome = clientA.callTool('slow_op', { ms: 15_000 }).then(
      () => 'resolved',
      err => (err instanceof Error ? err : new Error(String(err)))
    );
    await new Promise(resolve => setTimeout(resolve, 80));
    const disabledSnap = await service.patchServer({
      targetScope: 'work',
      workId: 'w1',
      name: 'work_srv',
      enabled: false
    });
    expect(disabledSnap.servers.find(s => s.name === 'work_srv')?.state).toBe('disabled');
    expect(await slowOutcome).toBeInstanceOf(Error);
  });

  it('支持远程 HTTP MCP 的 OAuth 2.1 本机回环回调、手动粘贴重定向地址及登出清理', async () => {
    const fx = await setupFixture();
    const oauthSrv = await startLocalOAuthMcpServer();
    cleanups.push(() => oauthSrv.close());

    await saveValidatedMcpConfig(
      globalMcpConfigFile(fx.agentDir),
      'global',
      JSON.stringify({
        mcpServers: {
          remote_wiki: { url: oauthSrv.mcpUrl }
        }
      })
    );

    const service = new HostMcpService({
      agentDir: fx.agentDir,
      defaultGlobalCwd: fx.globalCwd,
      resolveWorkFilesDir: () => null
    });
    cleanups.push(() => service.close());

    // 未登录前自动识别为 needs-auth
    const initial = await waitFor(
      () => service.getSnapshot(null),
      s => s.servers[0]?.state === 'needs-auth'
    );
    expect(initial.servers[0]?.state).toBe('needs-auth');

    // 方式 1：发起 OAuth 登录，模拟系统浏览器访问授权地址并跟随回跳到本机 loopback 回调端口
    const started = await service.startSignIn({ workId: null, name: 'remote_wiki' });
    expect(started.authorized).toBe(false);
    expect(started.authorizationUrl).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/authorize\?/);

    const callbackResp = await fetch(started.authorizationUrl!);
    expect(callbackResp.status).toBe(200);

    const connectedAfterLoopback = await waitFor(
      () => service.getSnapshot(null),
      s => s.servers[0]?.state === 'connected'
    );
    expect(connectedAfterLoopback.servers[0]).toMatchObject({
      state: 'connected',
      hasStoredAuth: true
    });
    expect(connectedAfterLoopback.servers[0]?.tools.map(t => t.name)).toEqual(['whoami']);

    // 登出后清除 mcp-auth.json 凭据并回到 needs-auth
    const signedOut = await service.signOut({ workId: null, name: 'remote_wiki' });
    expect(signedOut.servers[0]).toMatchObject({
      state: 'needs-auth',
      hasStoredAuth: false
    });

    // 方式 2：再次发起 OAuth 登录，不访问本机回调端口，改为捕获 302 Location 后手动粘贴重定向 URL
    const startedManual = await service.startSignIn({ workId: null, name: 'remote_wiki' });
    const authRes = await fetch(startedManual.authorizationUrl!, { redirect: 'manual' });
    const redirectLocation = authRes.headers.get('location')!;
    expect(redirectLocation).toContain('code=');

    const afterManual = await service.submitRedirectUrl({
      workId: null,
      name: 'remote_wiki',
      redirectUrl: redirectLocation
    });
    expect(afterManual.servers[0]).toMatchObject({
      state: 'connected',
      hasStoredAuth: true
    });

    const client = new McpClient({ name: 'authed-session', version: '1.0.0' });
    cleanups.push(() => client.close());
    await client.connect(await service.createSessionTransport(null, 'remote_wiki'));
    const toolRes = await client.callTool('whoami', {});
    expect((toolRes.content[0] as { text: string }).text).toBe('authenticated-author');
  });

  it('作品级服务的登录凭据与全局同名服务分开保存，取消后的登录不再接受回跳地址，永久清空作品只清除它的凭据', async () => {
    const fx = await setupFixture();
    const oauthSrv = await startLocalOAuthMcpServer();
    cleanups.push(() => oauthSrv.close());
    const json = JSON.stringify({ mcpServers: { remote: { url: oauthSrv.mcpUrl } } });
    await saveValidatedMcpConfig(globalMcpConfigFile(fx.agentDir), 'global', json);
    await saveValidatedMcpConfig(workMcpConfigFile(fx.workFilesDir), 'work', json);

    const service = new HostMcpService({
      agentDir: fx.agentDir,
      defaultGlobalCwd: fx.globalCwd,
      resolveWorkFilesDir: workId => (workId === 'w1' ? fx.workFilesDir : null)
    });
    cleanups.push(() => service.close());
    const remote = async (workId: string | null) => (await service.getSnapshot(workId)).servers[0]!;
    const signIn = async (workId: string | null) => {
      const started = await service.startSignIn({ workId, name: 'remote' });
      const location = (await fetch(started.authorizationUrl!, { redirect: 'manual' })).headers.get('location')!;
      return { workId, name: 'remote', redirectUrl: location };
    };

    // 全局服务登录后，作品里同名的服务仍是未登录
    await service.submitRedirectUrl(await signIn(null));
    expect(await remote(null)).toMatchObject({ definedIn: 'global', state: 'connected', hasStoredAuth: true });
    await waitFor(
      () => remote('w1'),
      view => view.state === 'needs-auth'
    );
    expect(await remote('w1')).toMatchObject({ definedIn: 'work', state: 'needs-auth', hasStoredAuth: false });

    // 取消登录后，之前拿到的回跳地址不再生效
    const cancelled = await signIn('w1');
    expect((await remote('w1')).signingIn).toBeDefined();
    expect((await service.cancelSignIn({ workId: 'w1', name: 'remote' })).servers[0]!.signingIn).toBeUndefined();
    await expect(service.submitRedirectUrl(cancelled)).rejects.toThrow('没有正在等待回调的 OAuth 登录');
    expect(await remote('w1')).toMatchObject({ state: 'needs-auth', hasStoredAuth: false });

    await service.submitRedirectUrl(await signIn('w1'));
    expect(await remote('w1')).toMatchObject({ state: 'connected', hasStoredAuth: true });

    // 永久清空作品：作品的凭据清除，全局服务不受影响
    await service.closeWork('w1', { purgeCredentials: true });
    const afterPurge = await waitFor(
      () => remote('w1'),
      view => view.state === 'needs-auth'
    );
    expect(afterPurge).toMatchObject({ state: 'needs-auth', hasStoredAuth: false });
    expect(await remote(null)).toMatchObject({ state: 'connected', hasStoredAuth: true });
  }, 20_000);
});
