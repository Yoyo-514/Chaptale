import {
  CreateSessionArgsValidator,
  DeleteSessionArgsValidator,
  DeleteSessionsArgsValidator,
  ExportSessionArgsValidator,
  IPC_CHANNELS,
  ReadSessionImageArgsValidator,
  RenameSessionArgsValidator,
  SessionIdArgsValidator,
  SetSessionLeafArgsValidator
} from '@chaptale/ipc-contract';
import type {
  CreateSessionOptions,
  DeleteSessionPayload,
  DeleteSessionsPayload,
  ExportSessionPayload,
  ReadSessionImagePayload,
  RenameSessionPayload,
  SetSessionLeafPayload
} from '@chaptale/ipc-contract';

import type { UiShell } from '../../core/ipc-ports';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import { exportSessionHtmlToFile } from './export';
import type { SessionRepository } from './repository';

/** 归属会话读写、导出与存储目录频道；IPC 层负责信任及参数结构校验，持久化语义交给仓储。 */
export function registerSessionIpc(
  sessionRepository: SessionRepository,
  ui: UiShell,
  hooks: {
    /** 会话删除后的清理钩子（如会话级 todo 清单）；失败不影响删除结果。 */
    onSessionsDeleted?: (sessionIds: string[]) => void;
  } = {}
) {
  handleTrustedIpc(IPC_CHANNELS.session.list, () => sessionRepository.list());

  handleValidatedIpc(
    IPC_CHANNELS.session.create,
    CreateSessionArgsValidator,
    (_event, options?: CreateSessionOptions) => sessionRepository.create(options)
  );

  handleValidatedIpc(IPC_CHANNELS.session.getEntries, SessionIdArgsValidator, (_event, sessionId: string) =>
    sessionRepository.getEntries(sessionId)
  );

  handleValidatedIpc(IPC_CHANNELS.session.getMessages, SessionIdArgsValidator, (_event, sessionId: string) =>
    sessionRepository.getMessages(sessionId)
  );

  handleValidatedIpc(
    IPC_CHANNELS.session.readImage,
    ReadSessionImageArgsValidator,
    (_event, payload: ReadSessionImagePayload) => sessionRepository.readImage(payload)
  );

  handleValidatedIpc(IPC_CHANNELS.session.rename, RenameSessionArgsValidator, (_event, payload: RenameSessionPayload) =>
    sessionRepository.appendSessionInfo(payload.sessionId, payload.name)
  );

  handleValidatedIpc(
    IPC_CHANNELS.session.exportHtml,
    ExportSessionArgsValidator,
    (_event, payload: ExportSessionPayload) => exportSessionHtmlToFile(sessionRepository, payload.sessionId, ui)
  );

  handleValidatedIpc(
    IPC_CHANNELS.session.delete,
    DeleteSessionArgsValidator,
    async (_event, payload: DeleteSessionPayload) => {
      await sessionRepository.delete(payload.sessionId);
      hooks.onSessionsDeleted?.([payload.sessionId]);
    }
  );

  handleValidatedIpc(
    IPC_CHANNELS.session.deleteMany,
    DeleteSessionsArgsValidator,
    async (_event, payload: DeleteSessionsPayload) => {
      await sessionRepository.deleteMany(payload.sessionIds);
      hooks.onSessionsDeleted?.(payload.sessionIds);
    }
  );

  handleValidatedIpc(
    IPC_CHANNELS.session.setLeaf,
    SetSessionLeafArgsValidator,
    (_event, payload: SetSessionLeafPayload) => sessionRepository.setLeafId(payload.sessionId, payload.leafId)
  );

  handleTrustedIpc(IPC_CHANNELS.session.getStorageDebugInfo, () => sessionRepository.getStorageDebugInfo());

  handleTrustedIpc(IPC_CHANNELS.session.openStorageDir, async () => {
    await ui.openPath(await sessionRepository.ensureSessionDir());
  });
}
