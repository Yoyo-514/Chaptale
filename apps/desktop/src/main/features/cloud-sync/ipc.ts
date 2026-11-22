import { IPC_CHANNELS } from '../../../bridge/channels';
import type { CloudBackupWorkArgs, CloudBackupFileArgs, CloudProviderArgs } from '../../../bridge/cloud-sync';
import {
  CloudBackupWorkArgsValidator,
  CloudBackupFileArgsValidator,
  CloudDiscardDownloadArgsValidator,
  CloudNoArgsValidator,
  CloudProviderArgsValidator
} from '../../../bridge/schemas/cloud-sync';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { CloudBackups } from './backups';
import type { CloudSyncService } from './service';

export function registerCloudSyncIpc(service: CloudSyncService, backups: CloudBackups) {
  handleValidatedIpc(IPC_CHANNELS.cloudSync.getState, CloudNoArgsValidator, () => service.getState());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.beginAuth, CloudProviderArgsValidator, (_event, args: CloudProviderArgs) =>
    service.beginAuth(args.provider)
  );
  handleValidatedIpc(IPC_CHANNELS.cloudSync.cancelAuth, CloudNoArgsValidator, () => service.cancelAuth());
  handleValidatedIpc(IPC_CHANNELS.cloudSync.signOut, CloudProviderArgsValidator, (_event, args: CloudProviderArgs) =>
    service.signOut(args.provider)
  );
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.backupWork,
    CloudBackupWorkArgsValidator,
    (event, args: CloudBackupWorkArgs) =>
      backups.backupWork(args, progress => {
        if (!event.sender.isDestroyed()) event.sender.send(IPC_CHANNELS.cloudSync.backupProgress, progress);
      })
  );
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.listBackups,
    CloudProviderArgsValidator,
    (_event, args: CloudProviderArgs) => service.listBackups(args.provider)
  );
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.downloadBackup,
    CloudBackupFileArgsValidator,
    (_event, args: CloudBackupFileArgs) => backups.downloadBackup(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.deleteBackup,
    CloudBackupFileArgsValidator,
    (_event, args: CloudBackupFileArgs) => service.deleteBackup(args.provider, args.fileId)
  );
  handleValidatedIpc(
    IPC_CHANNELS.cloudSync.discardDownload,
    CloudDiscardDownloadArgsValidator,
    (_event, path: string) => backups.discardDownload(path)
  );
}
