import {
  IPC_CHANNELS,
  WorkspaceRootArgsValidator,
  LibraryLinkArgsValidator,
  ComposePackArgsValidator,
  PackIdArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { LibraryService } from './service';

export function registerLibraryIpc(service: LibraryService) {
  handleValidatedIpc(
    IPC_CHANNELS.library.listAssets,
    WorkspaceRootArgsValidator,
    (_event, args: { rootPath: string }) => service.listAssets(args.rootPath)
  );
  handleValidatedIpc(
    IPC_CHANNELS.library.resolveLink,
    LibraryLinkArgsValidator,
    (_event, args: { rootPath: string; link: string }) => service.resolveLink(args.rootPath, args.link)
  );
  handleValidatedIpc(
    IPC_CHANNELS.library.composePack,
    ComposePackArgsValidator,
    (_event, args: Parameters<LibraryService['composePack']>[0]) => service.composePack(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.library.freezePack,
    ComposePackArgsValidator,
    (_event, args: Parameters<LibraryService['composePack']>[0]) => service.freezePack(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.library.readPack,
    PackIdArgsValidator,
    (_event, args: { rootPath: string; packId: string }) => service.readPack(args.rootPath, args.packId)
  );
  handleValidatedIpc(
    IPC_CHANNELS.library.checkPack,
    PackIdArgsValidator,
    (_event, args: { rootPath: string; packId: string }) => service.checkPack(args.rootPath, args.packId)
  );
}
