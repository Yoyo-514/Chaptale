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

export function registerWorkspaceIpc(service: WorkspaceService, ui?: UiShell) {
  service.onChange(event => ui?.broadcast(IPC_CHANNELS.workspace.changed, event));
  handleValidatedIpc(IPC_CHANNELS.workspace.getState, WorkspaceGetStateArgsValidator, () => service.getState());
  handleValidatedIpc(
    IPC_CHANNELS.workspace.selectParent,
    WorkspaceGetStateArgsValidator,
    async event => (await ui?.pickDirectory(ui.resolveOwner(event), '选择新作品的存放位置')) ?? null
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
