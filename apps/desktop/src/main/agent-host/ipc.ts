import { BrowserWindow } from 'electron';

import type { HostCommand } from '@chaptale/agent-host/protocol';
import { AGENT_HOST_CHANNELS } from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../infra/security/trusted-ipc';
import type { DesktopAgentProcess } from './process';

export function registerAgentHostIpc(host: DesktopAgentProcess): void {
  handleTrustedIpc(AGENT_HOST_CHANNELS.request, (_event, command: HostCommand) =>
    host.request(command.method, command.input)
  );
  host.subscribe(event => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(AGENT_HOST_CHANNELS.event, event);
  });
  host.onExit(message => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(AGENT_HOST_CHANNELS.disconnected, message);
  });
}
