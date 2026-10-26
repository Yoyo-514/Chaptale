import type { HostBootstrapOptions } from '@chaptale/agent-host/application';
import type { HostCommands, HostEvent } from '@chaptale/agent-host/protocol';
import type { RpcPacket, RpcRequest } from '@chaptale/contracts';
import type { CreationCommands, CreationEvent } from '@chaptale/creation/contracts';

export interface ApplicationBootstrapOptions {
  // 作品应用在业务进程内创建后注入，启动参数只含可序列化的目录。
  agent: Omit<HostBootstrapOptions, 'creation'>;
  creationDir: string;
}

/** 进程内共用传输，业务命令和事件按来源分别处理。 */
export type ApplicationRequest =
  | { type: 'agent'; request: RpcRequest<HostCommands> }
  | { type: 'creation'; request: RpcRequest<CreationCommands> }
  | { type: 'shutdown' };

export type ApplicationPacket =
  | { type: 'agent'; packet: RpcPacket<HostEvent> }
  | { type: 'creation'; packet: RpcPacket<CreationEvent> }
  | { type: 'ready' }
  | { type: 'failed'; error: string };
