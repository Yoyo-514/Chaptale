import { ipcRenderer, type IpcRendererEvent } from 'electron';

import type { CommandDefinitions, RpcClient } from '@chaptale/contracts';

import { APPLICATION_HOST_CHANNELS, type HostChannels } from '../../bridge/channels';

/** 只暴露指定业务通道的请求与订阅；断线由调用方决定重连和状态恢复。 */
export function createHostApi<C extends CommandDefinitions<C>, E>(
  channels: HostChannels
): RpcClient<C, E> & {
  onDisconnected(listener: (message: string) => void): () => void;
} {
  return {
    request: (method, input) => ipcRenderer.invoke(channels.request, { method, input }),
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, event: E) => listener(event);
      ipcRenderer.on(channels.event, handler);
      return () => ipcRenderer.removeListener(channels.event, handler);
    },
    onDisconnected(listener) {
      const handler = (_event: IpcRendererEvent, message: string) => listener(message);
      ipcRenderer.on(APPLICATION_HOST_CHANNELS.disconnected, handler);
      return () => ipcRenderer.removeListener(APPLICATION_HOST_CHANNELS.disconnected, handler);
    }
  };
}
