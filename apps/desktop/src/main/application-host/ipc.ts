import { BrowserWindow, type OpenDialogOptions } from 'electron';

import type { CommandDefinitions, RpcClient, RpcCommand } from '@chaptale/contracts';

import { APPLICATION_HOST_CHANNELS, type HostChannels } from '../../bridge/channels';
import type { DesktopCreationClient } from '../../bridge/contracts';
import { showOpenDialog } from '../infra/electron/dialog';
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
  handleTrustedIpc(
    APPLICATION_HOST_CHANNELS.creation.selectPaths,
    async (event, purpose: Parameters<DesktopCreationClient['selectPaths']>[0]) => {
      let options: OpenDialogOptions;
      switch (purpose) {
        case 'import-files':
          options = {
            title: '导入文稿或资料',
            properties: ['openFile', 'multiSelections'],
            filters: [{ name: '文本文件', extensions: ['txt', 'md', 'markdown'] }]
          };
          break;
        case 'import-directory':
          options = { title: '选择导入目录', properties: ['openDirectory'] };
          break;
        case 'export-directory':
          options = { title: '选择导出目录', properties: ['openDirectory', 'createDirectory'] };
          break;
        default:
          throw new Error('文件选择用途无效');
      }
      const result = await showOpenDialog(BrowserWindow.fromWebContents(event.sender), options);
      return result.canceled ? null : result.filePaths;
    }
  );
  host.onExit(message => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(APPLICATION_HOST_CHANNELS.disconnected, message);
  });
}
