import { shell, utilityProcess, type UtilityProcess } from 'electron';

import type { AgentClient, HostCommands, HostEvent } from '@chaptale/agent-host/protocol';
import type { CreationClient, CreationCommands, CreationEvent } from '@chaptale/creation/contracts';
import { RpcConnection } from '@chaptale/ui/client';

import type { ApplicationBootstrapOptions, ApplicationPacket, ApplicationRequest } from './protocol.ts';

interface Connections {
  agent: RpcConnection<HostCommands, HostEvent>;
  creation: RpcConnection<CreationCommands, CreationEvent>;
}
/** 宿主退出时附带的最近错误输出长度（字符）。 */
const stderrTailLength = 2000;

export interface ApplicationProcessOptions extends ApplicationBootstrapOptions {
  script: string;
}

/** Agent 与作品共用一个业务进程；窗口卸载只解除订阅。 */
export class DesktopApplicationProcess {
  private readonly options: ApplicationProcessOptions;
  private readonly agentListeners = new Set<(event: HostEvent) => void>();
  private readonly creationListeners = new Set<(event: CreationEvent) => void>();
  private readonly exits = new Set<(message: string) => void>();
  private child?: UtilityProcess;
  private connection?: Promise<Connections>;
  private exited?: Promise<void>;
  private disposed = false;

  constructor(options: ApplicationProcessOptions) {
    this.options = options;
  }

  readonly agent: AgentClient = {
    request: async (method, input) => {
      const output = await (await this.connect()).agent.request(method, input);
      // 宿主进程不能使用 shell；删除会话时由主进程把宿主解析出的历史文件移入回收站。
      if (method === 'deleteSessions')
        for (const file of (output as { files: string[] }).files) await shell.trashItem(file);
      // 覆盖导入与恢复换下的作品目录同样由主进程移入回收站。
      if (method === 'importWorkPackage' || method === 'restoreWorkSnapshot')
        for (const file of (output as { files: string[] }).files) await shell.trashItem(file);
      return output;
    },
    subscribe: listener => {
      this.agentListeners.add(listener);
      return () => this.agentListeners.delete(listener);
    }
  };

  readonly creation: CreationClient = {
    request: async (method, input) => {
      const output = await (await this.connect()).creation.request(method, input);
      // 永久清空作品时，宿主已关闭作品数据库连接，由主进程把文件移入系统回收站。
      if (method === 'purgeWork' && output.ok)
        for (const file of (output.value as { files: string[] }).files) await shell.trashItem(file);
      return output;
    },
    subscribe: listener => {
      this.creationListeners.add(listener);
      return () => this.creationListeners.delete(listener);
    }
  };

  onExit(listener: (message: string) => void): () => void {
    this.exits.add(listener);
    return () => this.exits.delete(listener);
  }

  private connect(): Promise<Connections> {
    if (this.disposed) throw new Error('应用宿主已关闭');
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
      serviceName: 'Chaptale Application',
      env,
      stdio: 'pipe'
    });
    this.child = child;
    // 转发宿主输出到主进程终端；保留最近的错误输出，退出时附在错误里，打包后没有终端也能看到原因。
    let stderrTail = '';
    child.stdout?.on('data', (chunk: Buffer) => process.stdout.write(`[application-host] ${chunk}`));
    child.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(`[application-host] ${chunk}`);
      stderrTail = (stderrTail + chunk.toString()).slice(-stderrTailLength);
    });
    const send = (request: ApplicationRequest) => {
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      child.postMessage(request);
    };
    const clients: Connections = {
      agent: new RpcConnection(request => send({ type: 'agent', request })),
      creation: new RpcConnection(request => send({ type: 'creation', request }))
    };
    clients.agent.subscribe(event => {
      for (const listener of this.agentListeners) listener(event);
    });
    clients.creation.subscribe(event => {
      for (const listener of this.creationListeners) listener(event);
    });
    this.connection = new Promise<Connections>((resolve, reject) => {
      child.on('message', (message: ApplicationPacket) => {
        switch (message.type) {
          case 'ready':
            resolve(clients);
            break;
          case 'failed':
            reject(new Error(message.error));
            break;
          case 'agent':
            clients.agent.receive(message.packet);
            break;
          case 'creation':
            clients.creation.receive(message.packet);
            break;
        }
      });
      this.exited = new Promise<void>(finished => {
        child.once('exit', code => {
          const detail = stderrTail.trim();
          const error = new Error(
            `应用宿主已退出（${code}），请重新连接；作品重新读取快照，会话重新打开历史${
              detail
                ? `
${detail}`
                : ''
            }`
          );
          clients.agent.disconnect(error);
          clients.creation.disconnect(error);
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
    this.agentListeners.clear();
    this.creationListeners.clear();
    this.exits.clear();
    const child = this.child;
    if (!child) return;
    try {
      await this.connection;
    } catch {
      await this.exited;
      return;
    }
    // oxlint-disable-next-line unicorn/require-post-message-target-origin
    child.postMessage({ type: 'shutdown' } satisfies ApplicationRequest);
    await this.exited;
  }
}
