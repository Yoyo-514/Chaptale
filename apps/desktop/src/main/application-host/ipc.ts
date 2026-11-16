import { BrowserWindow, dialog, shell, type OpenDialogOptions } from 'electron';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import type { CommandDefinitions, RpcClient, RpcCommand } from '@chaptale/contracts';

import { APPLICATION_HOST_CHANNELS, type HostChannels } from '../../bridge/channels';
import type {
  AddFileDataInput,
  DesktopAgentClient,
  DesktopCreationClient,
  FileAction,
  FileReadTarget,
  FileTarget
} from '../../bridge/contracts';
import { showOpenDialog } from '../infra/electron/dialog';
import { openPathOrThrow } from '../infra/electron/shell';
import { handleTrustedIpc } from '../infra/security/trusted-ipc';
import type { DesktopApplicationProcess } from './process';
import { resolveAuthorizedSkillRevealPath } from './skill-paths';

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
    APPLICATION_HOST_CHANNELS.agent.selectSkillSource,
    async (event, kind: Parameters<NonNullable<DesktopAgentClient['selectSkillSource']>>[0]) => {
      let options: OpenDialogOptions;
      if (kind === 'directory') {
        options = { title: '选择包含 SKILL.md 的技能文件夹', properties: ['openDirectory'] };
      } else if (kind === 'file') {
        options = {
          title: '选择技能 Markdown 文件',
          properties: ['openFile'],
          filters: [{ name: 'Markdown 技能文件', extensions: ['md'] }]
        };
      } else {
        throw new Error('技能导入源类型无效');
      }
      const result = await showOpenDialog(BrowserWindow.fromWebContents(event.sender), options);
      return result.canceled ? null : (result.filePaths[0] ?? null);
    }
  );
  handleTrustedIpc(
    APPLICATION_HOST_CHANNELS.agent.revealSkillPath,
    async (_event, input: Parameters<NonNullable<DesktopAgentClient['revealSkillPath']>>[0]) => {
      const snapshot = await host.agent.request('listSkills', {
        workId: input?.workId ?? null
      });
      const resolved = resolveAuthorizedSkillRevealPath(snapshot, input?.filePath);
      if (resolved.kind === 'directory') {
        await mkdir(resolved.path, { recursive: true });
        return openPathOrThrow(resolved.path);
      }
      shell.showItemInFolder(resolved.path);
    }
  );
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
        case 'import-package':
          options = {
            title: '导入作品包',
            properties: ['openFile'],
            filters: [{ name: 'Chaptale 作品包', extensions: ['chaptale'] }]
          };
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
  handleTrustedIpc(APPLICATION_HOST_CHANNELS.creation.selectPackageSavePath, async (event, title: string) => {
    const owner = BrowserWindow.fromWebContents(event.sender);
    const options = {
      title: '导出作品包',
      defaultPath: `${String(title).replace(/[\\/:*?"<>|]/g, '_')}.chaptale`,
      filters: [{ name: 'Chaptale 作品包', extensions: ['chaptale'] }]
    };
    const result = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  });
  async function locate(target: FileTarget, trashed = false): Promise<string> {
    const result = await host.creation.request('locateFile', {
      workId: target.workId,
      entryId: target.entryId,
      trashed
    });
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
  handleTrustedIpc(APPLICATION_HOST_CHANNELS.creation.readFile, async (_event, target: FileReadTarget) =>
    readFile(await locate(target, target.trashed))
  );
  // 先写入临时目录再按路径添加，复制、登记与失败清理沿用 addFiles。
  handleTrustedIpc(APPLICATION_HOST_CHANNELS.creation.addFileData, async (_event, input: AddFileDataInput) => {
    const directory = await mkdtemp(join(tmpdir(), 'chaptale-file-'));
    try {
      const path = join(directory, basename(input.fileName));
      await writeFile(path, input.data);
      const result = await host.creation.request('addFiles', {
        commandId: randomUUID(),
        workId: input.workId,
        parentId: input.parentId,
        paths: [path]
      });
      if (!result.ok) throw new Error(result.error.message);
      return result.value;
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
  host.onExit(message => {
    for (const window of BrowserWindow.getAllWindows())
      window.webContents.send(APPLICATION_HOST_CHANNELS.disconnected, message);
  });
}
