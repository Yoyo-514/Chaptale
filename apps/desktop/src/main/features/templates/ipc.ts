import {
  IPC_CHANNELS,
  CreateAssetValidator,
  IdentifyAssetValidator,
  WorkspaceRootArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { TemplateService } from './service';
export function registerTemplatesIpc(service: TemplateService) {
  handleValidatedIpc(IPC_CHANNELS.templates.list, WorkspaceRootArgsValidator, (_event, args: { rootPath: string }) =>
    service.list(args.rootPath)
  );
  handleValidatedIpc(
    IPC_CHANNELS.templates.create,
    CreateAssetValidator,
    (_event, args: Parameters<TemplateService['create']>[0]) => service.create(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.templates.identify,
    IdentifyAssetValidator,
    (_event, args: Parameters<TemplateService['identify']>[0]) => service.identify(args)
  );
}
