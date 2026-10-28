import { BrowserWindow, shell, type OpenDialogOptions } from 'electron';
import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';

import type { CommandDefinitions, RpcClient, RpcCommand } from '@chaptale/contracts';

import { APPLICATION_HOST_CHANNELS, type HostChannels } from '../../bridge/channels';
import type { DesktopCreationClient, FileAction, FileTarget } from '../../bridge/contracts';
import { showOpenDialog } from '../infra/electron/dialog';
import { openPathOrThrow } from '../infra/electron/shell';
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
        case 'add-files':
          options = { title: '添加文件', properties: ['openFile', 'multiSelections'] };
          break;
        default:
          throw new Error('文件选择用途无效');
      }
      const result = await showOpenDialog(BrowserWindow.fromWebContents(event.sender), options);
      return result.canceled ? null : result.filePaths;
    }
  );
  async function locate(target: FileTarget): Promise<string> {
    const result = await host.creation.request('locateFile', { workId: target.workId, entryId: target.entryId });
    if (!result.ok) throw new Error(result.error.message);
    return result.value.path;
  }
  handleTrustedIpc(
    APPLICATION_HOST_CHANNELS.creation.fileAction,
    async (_event, target: FileTarget, action: FileAction) => {
      const path = await locate(target);
      switch (action) {
        case 'open':
          return openPathOrThrow(path);
        case 'open-with':
          if (process.platform !== 'win32') throw new Error('当前系统不支持选择打开方式');
          // Windows 的“打开方式”对话框。
          spawn('rundll32.exe', ['shell32.dll,OpenAs_RunDLL', path], { detached: true, stdio: 'ignore' }).unref();
          return;
        case 'show-in-folder':
          shell.showItemInFolder(path);
          return;
        default:
          throw new Error('文件操作无效');
      }
    }
  );
  handleTrustedIpc(APPLICATION_HOST_CHANNELS.creation.readFile, async (_event, target: FileTarget) =>
    readFile(await locate(target))
  );
  host.onExit(message => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(APPLICATION_HOST_CHANNELS.disconnected, message);
  });
}
