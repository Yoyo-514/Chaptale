import {
  IPC_CHANNELS,
  ReviewRunValidator,
  ReviewIdValidator,
  ResolveIssueValidator,
  WorkspaceRootArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { ReviewService } from './service';
export function registerReviewIpc(service: ReviewService) {
  handleValidatedIpc(
    IPC_CHANNELS.reviews.run,
    ReviewRunValidator,
    (_event, args: Parameters<ReviewService['run']>[0]) => service.run(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.reviews.cancel,
    ReviewIdValidator,
    (_event, args: Parameters<ReviewService['cancel']>[0]) => service.cancel(args)
  );
  handleValidatedIpc(IPC_CHANNELS.reviews.list, WorkspaceRootArgsValidator, (_event, args: { rootPath: string }) =>
    service.list(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.reviews.read,
    ReviewIdValidator,
    (_event, args: Parameters<ReviewService['read']>[0]) => service.read(args)
  );
  handleValidatedIpc(
    IPC_CHANNELS.reviews.resolve,
    ResolveIssueValidator,
    (_event, args: Parameters<ReviewService['resolve']>[0]) => service.resolve(args)
  );
}
