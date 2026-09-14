import {
  CloudArchiveArgsValidator,
  CloudArchiveListArgsValidator,
  CloudBindArgsValidator,
  CloudListFoldersArgsValidator,
  CloudNoArgsValidator,
  CloudProviderArgsValidator,
  CloudRestoreArgsValidator,
  CloudRestoreDiffArgsValidator,
  IPC_CHANNELS,
  type CloudArchiveArgs,
  type CloudArchiveListArgs,
  type CloudBindArgs,
  type CloudListFoldersArgs,
  type CloudProviderArgs,
  type CloudRestoreArgs,
  type CloudRestoreDiffArgs
} from '@chaptale/ipc-contract';

import type { UiShell } from '../../core/ipc-ports';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { CloudSyncService } from './service';

export function registerCloudSyncIpc(service: CloudSyncService, ui?: UiShell) {
  service.onProgress(progress => ui?.broadcast(IPC_CHANNELS.cloudSync.backupProgress, progress));

  handleValidatedIpc(IPC_CHANNELS.cloudSync.getState, CloudNoArgsValidator, () => service.getState());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.getBinding, CloudNoArgsValidator, () => service.getBinding());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.beginAuth, CloudProviderArgsValidator, (_event, args: CloudProviderArgs) =>
    service.beginAuth(args.provider)
  );
  handleValidatedIpc(IPC_CHANNELS.cloudSync.cancelAuth, CloudNoArgsValidator, () => service.cancelAuth());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.signOut, CloudProviderArgsValidator, (_event, args: CloudProviderArgs) =>
    service.signOut(args.provider)
  );
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.listFolders,
    CloudListFoldersArgsValidator,
    (_event, args: CloudListFoldersArgs) => service.listFolders(args)
  );
  handleValidatedIpc(IPC_CHANNELS.cloudSync.bind, CloudBindArgsValidator, (_event, args: CloudBindArgs) =>
    service.bind(args)
  );
  handleValidatedIpc(IPC_CHANNELS.cloudSync.unbind, CloudNoArgsValidator, () => service.unbind());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.listBackups, CloudNoArgsValidator, () => service.listBackups());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.createBackup, CloudNoArgsValidator, () => service.createBackup());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.planRestore, CloudArchiveArgsValidator, (_event, args: CloudArchiveArgs) =>
    service.planRestore(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.readRestoreDiff,
    CloudRestoreDiffArgsValidator,
    (_event, args: CloudRestoreDiffArgs) => service.readRestoreDiff(args)
  );
  handleValidatedIpc(IPC_CHANNELS.cloudSync.applyRestore, CloudRestoreArgsValidator, (_event, args: CloudRestoreArgs) =>
    service.applyRestore(args)
  );
  handleValidatedIpc(IPC_CHANNELS.cloudSync.cancelRestore, CloudNoArgsValidator, () => service.cancelRestore());
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.removeBackups,
    CloudArchiveListArgsValidator,
    (_event, args: CloudArchiveListArgs) => service.removeBackups(args)
  );
}
