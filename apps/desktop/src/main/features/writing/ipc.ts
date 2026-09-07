import {
  IPC_CHANNELS,
  DraftRequestValidator,
  CandidateIdArgsValidator,
  ApplyCandidateValidator,
  WritingTargetValidator,
  SnapshotReadValidator,
  WorkspaceRootArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { WritingService } from './service';

export function registerWritingIpc(service: WritingService) {
  handleValidatedIpc(
    IPC_CHANNELS.writing.generate,
    DraftRequestValidator,
    (_event, args: Parameters<WritingService['generate']>[0]) => service.generate(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.writing.cancel,
    CandidateIdArgsValidator,
    (_event, args: Parameters<WritingService['cancel']>[0]) => service.cancel(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.writing.listCandidates,
    WorkspaceRootArgsValidator,
    (_event, args: { rootPath: string }) => service.listCandidates(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.writing.readCandidate,
    CandidateIdArgsValidator,
    (_event, args: Parameters<WritingService['readCandidate']>[0]) => service.readCandidate(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.writing.discard,
    CandidateIdArgsValidator,
    (_event, args: Parameters<WritingService['discard']>[0]) => service.discard(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.writing.apply,
    ApplyCandidateValidator,
    (_event, args: Parameters<WritingService['apply']>[0]) => service.apply(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.writing.listVersions,
    WritingTargetValidator,
    (_event, args: Parameters<WritingService['listVersions']>[0]) => service.listVersions(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.writing.readVersion,
    SnapshotReadValidator,
    (_event, args: Parameters<WritingService['readVersion']>[0]) => service.readVersion(args)
  );
}
