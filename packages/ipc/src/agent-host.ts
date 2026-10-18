import type { AgentClient } from '@chaptale/agent-host/protocol';

export interface DesktopAgentClient extends AgentClient {
  onDisconnected(listener: (message: string) => void): () => void;
}

/** 新宿主使用 agent-host 的纯类型协议；IPC 只规定 Electron 通道名称。 */
export const AGENT_HOST_CHANNELS = {
  request: 'agent-host:request',
  event: 'agent-host:event',
  disconnected: 'agent-host:disconnected'
} as const;
