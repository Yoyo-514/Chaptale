import { BrowserWindow } from 'electron';

import type { CommandDefinitions, RpcClient, RpcCommand } from '@chaptale/contracts';

import { APPLICATION_HOST_CHANNELS, type HostChannels } from '../../bridge/channels';
import { handleTrustedIpc } from '../infra/security/trusted-ipc';
import type { DesktopApplicationProcess } from './process';

function registerClient<C extends CommandDefinitions<C>, E>(client: RpcClient<C, E>, channels: HostChannels): void {
  handleTrustedIpc(channels.request, (_event, command: RpcCommand<C>) => client.request(command.method, command.input));
  client.subscribe(event => {
    for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channels.event, event);
  });
}

export function registerApplicationHostIpc(host: DesktopApplicationProcess): void {
  registerClient(host.agent, APPLICATION_HOST_CHANNELS.agent);
  registerClient(host.creation, APPLICATION_HOST_CHANNELS.creation);
  host.onExit(message => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(APPLICATION_HOST_CHANNELS.disconnected, message);
  });
}
