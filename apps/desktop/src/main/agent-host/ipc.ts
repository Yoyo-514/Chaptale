import { BrowserWindow } from 'electron';

import type { HostCommand } from '@chaptale/agent-host/protocol';
import { AGENT_HOST_CHANNELS } from '@chaptale/ipc-contract';

import type { DesktopApplicationProcess } from '../application-host/process';
import { handleTrustedIpc } from '../infra/security/trusted-ipc';

export function registerAgentHostIpc(host: DesktopApplicationProcess): void {
  handleTrustedIpc(AGENT_HOST_CHANNELS.request, (_event, command: HostCommand) =>
    host.agent.request(command.method, command.input)
  );
  host.agent.subscribe(event => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(AGENT_HOST_CHANNELS.event, event);
  });
  host.onExit(message => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(AGENT_HOST_CHANNELS.disconnected, message);
  });
}
