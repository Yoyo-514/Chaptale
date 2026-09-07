import { IPC_CHANNELS, SettlementValidators } from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { SettlementService } from './service';

export function registerSettlementIpc(service: SettlementService) {
  handleValidatedIpc(IPC_CHANNELS.settlement.list, SettlementValidators.list, (_event, args) => service.list(args));
  handleValidatedIpc(IPC_CHANNELS.settlement.unsettled, SettlementValidators.unsettled, (_event, args) =>
    service.unsettled(args)
  );
  handleValidatedIpc(IPC_CHANNELS.settlement.prepare, SettlementValidators.prepare, (_event, args) =>
    service.prepare(args)
  );
  handleValidatedIpc(IPC_CHANNELS.settlement.start, SettlementValidators.start, (_event, args) => service.start(args));
  handleValidatedIpc(IPC_CHANNELS.settlement.read, SettlementValidators.read, (_event, args) =>
    service.store.details(args.rootPath, args.batchId)
  );
  handleValidatedIpc(IPC_CHANNELS.settlement.cancel, SettlementValidators.cancel, (_event, args) =>
    service.cancel(args)
  );
  handleValidatedIpc(IPC_CHANNELS.settlement.resolve, SettlementValidators.resolve, (_event, args) =>
    service.store.resolve(args)
  );
  handleValidatedIpc(IPC_CHANNELS.settlement.complete, SettlementValidators.complete, (_event, args) =>
    service.store.complete(args)
  );
}
