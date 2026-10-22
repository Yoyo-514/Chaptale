import { IPC_CHANNELS } from '../../../bridge/channels';
import type { CloudListFoldersArgs, CloudProviderArgs } from '../../../bridge/cloud-sync';
import {
  CloudListFoldersArgsValidator,
  CloudNoArgsValidator,
  CloudProviderArgsValidator
} from '../../../bridge/schemas/cloud-sync';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { CloudSyncService } from './service';

export function registerCloudSyncIpc(service: CloudSyncService) {
  handleValidatedIpc(IPC_CHANNELS.cloudSync.getState, CloudNoArgsValidator, () => service.getState());
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
}
