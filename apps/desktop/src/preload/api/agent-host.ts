import { ipcRenderer, type IpcRendererEvent } from 'electron';

import type { HostCommands, HostEvent } from '@chaptale/agent-host/protocol';
import { AGENT_HOST_CHANNELS, type DesktopAgentClient } from '@chaptale/ipc-contract';

/** 只暴露有限命令和订阅，Renderer 无法取得 Node、MessagePort 或原生会话对象。 */
export function createAgentHostApi(): DesktopAgentClient {
  return {
    request: <K extends keyof HostCommands>(method: K, input: HostCommands[K]['input']) =>
      ipcRenderer.invoke(AGENT_HOST_CHANNELS.request, { method, input }),
    subscribe(listener) {
      const handler = (_event: IpcRendererEvent, event: HostEvent) => listener(event);
      ipcRenderer.on(AGENT_HOST_CHANNELS.event, handler);
      return () => ipcRenderer.removeListener(AGENT_HOST_CHANNELS.event, handler);
    },
    onDisconnected(listener) {
      const handler = (_event: IpcRendererEvent, message: string) => listener(message);
      ipcRenderer.on(AGENT_HOST_CHANNELS.disconnected, handler);
      return () => ipcRenderer.removeListener(AGENT_HOST_CHANNELS.disconnected, handler);
    }
  };
}
