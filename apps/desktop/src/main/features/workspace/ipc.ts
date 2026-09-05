import {
  IPC_CHANNELS,
  ListDirectoryArgsValidator,
  WorkspaceGetStateArgsValidator,
  type ListDirectoryArgs
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
}
