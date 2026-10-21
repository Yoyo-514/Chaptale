/** Electron 通道由平台桥接持有，业务契约保持跨端可用。 */
export const APPLICATION_HOST_CHANNELS = {
  agent: { request: 'agent-host:request', event: 'agent-host:event' },
  creation: { request: 'creation:request', event: 'creation:event' },
  disconnected: 'application-host:disconnected'
} as const;

export interface HostChannels {
  request: string;
  event: string;
}
