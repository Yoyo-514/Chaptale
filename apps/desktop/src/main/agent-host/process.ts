import { utilityProcess, type UtilityProcess } from 'electron';

import type { HostBootstrapOptions } from '@chaptale/agent-host/application';
import type { AgentClient, HostCommands, HostEvent, HostPacket } from '@chaptale/agent-host/protocol';
import { RpcConnection } from '@chaptale/ui/client';

type AgentConnection = RpcConnection<HostCommands, HostEvent>;

export interface AgentProcessOptions extends HostBootstrapOptions {
  script: string;
}

/** 一个桌面宿主进程；窗口只订阅它，切换或卸载视图不会停止会话。 */
export class DesktopAgentProcess implements AgentClient {
  private readonly options: AgentProcessOptions;
  private readonly listeners = new Set<(event: HostEvent) => void>();
  private readonly exits = new Set<(message: string) => void>();
  private child?: UtilityProcess;
  private connection?: Promise<AgentConnection>;
  private exited?: Promise<void>;
  private disposed = false;

  constructor(options: AgentProcessOptions) {
    this.options = options;
  }

  async request<K extends keyof HostCommands>(
    method: K,
    input: HostCommands[K]['input']
  ): Promise<HostCommands[K]['output']> {
    if (this.disposed) throw new Error('Agent 宿主已关闭');
    const connection = await this.connect();
    return connection.request(method, input);
  }

  subscribe(listener: (event: HostEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  onExit(listener: (message: string) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  private connect(): Promise<AgentConnection> {
    if (this.connection) return this.connection;
    const allowed = new Set([
      'path',
      'pathext',
      'comspec',
      'systemroot',
      'windir',
      'temp',
      'tmp',
      'home',
      'userprofile',
      'localappdata',
      'appdata'
    ]);
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
    const child = utilityProcess.fork(this.options.script, [JSON.stringify(this.options)], {
      serviceName: 'Chaptale Agent',
      env,
      stdio: 'pipe'
    });
    this.child = child;
    const client = new RpcConnection<HostCommands, HostEvent>(request => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      child.postMessage(request);
    });
    client.subscribe(event => {
      for (const listener of this.listeners) listener(event);
    });
    this.connection = new Promise<AgentConnection>((resolve, reject) => {
      child.on('message', (packet: HostPacket | { type: 'ready' } | { type: 'failed'; error: string }) => {
        if (packet.type === 'ready') resolve(client);
        else if (packet.type === 'failed') reject(new Error(packet.error));
        else client.receive(packet);
      });
      this.exited = new Promise<void>(finished => {
        child.once('exit', code => {
          const error = new Error(`Agent 宿主已退出（${code}），请重新连接并打开历史会话`);
          client.disconnect(error);
          reject(error);
          this.connection = undefined;
          this.child = undefined;
          if (!this.disposed) for (const listener of this.exits) listener(error.message);
          finished();
        });
      });
    });
    return this.connection;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    const child = this.child;
    if (!child) return;
    try {
      await this.connection;
    } catch {
      await this.exited;
      return;
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    child.postMessage({ type: 'shutdown' });
    await this.exited;
    this.listeners.clear();
    this.exits.clear();
  }
}
