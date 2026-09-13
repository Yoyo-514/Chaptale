import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';

import {
  CreateEntryArgsValidator,
  CreateWorkspaceArgsValidator,
  type CreateWorkspaceArgs,
  EntryPathArgsValidator,
  MutateEntryArgsValidator,
  type EntryPathArgs,
  type MutateEntryArgs,
  IPC_CHANNELS,
  ListDirectoryArgsValidator,
  ReadDocumentArgsValidator,
  WriteDocumentArgsValidator,
  WorkspaceRootArgsValidator,
  CreateChapterArgsValidator,
  RecoveryPathArgsValidator,
  SaveRecoveryArgsValidator,
  type RecoveryPathArgs,
  type SaveRecoveryArgs,
  type CreateChapterArgs,
  WorkspaceGetStateArgsValidator,
  SelectDirectoryArgsValidator,
  type SelectDirectoryArgs,
  type CreateEntryArgs,
  type ListDirectoryArgs,
  type ReadDocumentArgs,
  type WriteDocumentArgs
} from '@chaptale/ipc-contract';

import type { UiShell } from '../../core/ipc-ports';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import { createWorkspace } from './create-workspace';
import { inspectWorkspaceEntry, mutateWorkspaceEntry, revealWorkspaceEntry } from './entry-operations';
import type { WorkspaceService } from './service';

/** 绝对目录核验：存放位置与默认对话框位置都用它。realpath 之后确认是目录，避免链接指向文件。 */
async function resolveDirectory(target: string): Promise<string> {
  if (!path.isAbsolute(target)) throw new Error('存放位置必须是绝对目录路径');

  const resolved = await realpath(target);

  if (!(await stat(resolved)).isDirectory()) throw new Error('存放位置不是目录');

  return resolved;
}

export function registerWorkspaceIpc(service: WorkspaceService, ui?: UiShell) {
  service.onChange(event => ui?.broadcast(IPC_CHANNELS.workspace.changed, event));
  handleValidatedIpc(IPC_CHANNELS.workspace.getState, WorkspaceGetStateArgsValidator, () => service.getState());
  handleValidatedIpc(
    IPC_CHANNELS.workspace.selectParent,
    SelectDirectoryArgsValidator,
    async (event, args: SelectDirectoryArgs = {}) => {
      if (!ui) throw new Error('系统目录选择器不可用');
      const defaultPath = args.defaultPath ? await resolveDirectory(args.defaultPath) : undefined;
      return (
        (await ui.pickDirectory(
          ui.resolveOwner(event),
          args.purpose === 'open' ? '选择已有作品目录' : '选择新作品的存放位置',
          defaultPath
        )) ?? null
      );
    }
  );
  handleValidatedIpc(
    IPC_CHANNELS.workspace.createWorkspace,
    CreateWorkspaceArgsValidator,
    (_event, args: CreateWorkspaceArgs) => createWorkspace(args)
  );
  handleValidatedIpc(IPC_CHANNELS.workspace.inspectEntry, EntryPathArgsValidator, (_event, args: EntryPathArgs) =>
    inspectWorkspaceEntry(service, args)
  );
  handleValidatedIpc(IPC_CHANNELS.workspace.mutateEntry, MutateEntryArgsValidator, (_event, args: MutateEntryArgs) =>
    mutateWorkspaceEntry(service, args, ui)
  );
  handleValidatedIpc(IPC_CHANNELS.workspace.revealEntry, EntryPathArgsValidator, (_event, args: EntryPathArgs) => {
    if (!ui) throw new Error('系统文件管理器不可用');
    return revealWorkspaceEntry(service, args, ui);
  });
  handleValidatedIpc(
    IPC_CHANNELS.workspace.listDirectory,
    ListDirectoryArgsValidator,
    (_event, args: ListDirectoryArgs) => service.listDirectory(args)
  );
  handleValidatedIpc(IPC_CHANNELS.workspace.createEntry, CreateEntryArgsValidator, (_event, args: CreateEntryArgs) =>
    service.createEntry(args)
  );
  handleValidatedIpc(IPC_CHANNELS.workspace.readDocument, ReadDocumentArgsValidator, (_event, args: ReadDocumentArgs) =>
    service.readDocument(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.workspace.writeDocument,
    WriteDocumentArgsValidator,
    (_event, args: WriteDocumentArgs) => service.writeDocument(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.workspace.getLayout,
    WorkspaceRootArgsValidator,
    (_event, args: { rootPath: string }) => service.getLayout(args.rootPath)
  );
  handleValidatedIpc(
    IPC_CHANNELS.workspace.createChapter,
    CreateChapterArgsValidator,
    (_event, args: CreateChapterArgs) => service.createChapter(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.workspace.listRecoveries,
    WorkspaceRootArgsValidator,
    (_event, args: { rootPath: string }) => service.listRecoveries(args.rootPath)
  );
  handleValidatedIpc(IPC_CHANNELS.workspace.readRecovery, RecoveryPathArgsValidator, (_event, args: RecoveryPathArgs) =>
    service.readRecovery(args)
  );
  handleValidatedIpc(IPC_CHANNELS.workspace.saveRecovery, SaveRecoveryArgsValidator, (_event, args: SaveRecoveryArgs) =>
    service.saveRecovery(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.workspace.discardRecovery,
    RecoveryPathArgsValidator,
    (_event, args: RecoveryPathArgs) => service.discardRecovery(args)
  );
}
