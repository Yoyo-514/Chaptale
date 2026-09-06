import {
  CreateEntryArgsValidator,
  IPC_CHANNELS,
  ListDirectoryArgsValidator,
  ReadDocumentArgsValidator,
  WorkspaceGetStateArgsValidator,
  type CreateEntryArgs,
  type ListDirectoryArgs,
  type ReadDocumentArgs
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { WorkspaceService } from './service';

export function registerWorkspaceIpc(service: WorkspaceService) {
  handleValidatedIpc(IPC_CHANNELS.workspace.getState, WorkspaceGetStateArgsValidator, () => service.getState());
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
}
