import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { handleTrustedIpc } from '../security/trusted-ipc';
import { openPathOrThrow } from '../infra/shell-gateway';
import { exportSessionHtmlToFile } from '../sessions/session-export';
import { PiSessionRepository } from '../services/session.repository';

import type {
  CreateSessionOptions,
  DeleteSessionPayload,
  DeleteSessionsPayload,
  ExportSessionPayload,
  ReadSessionImagePayload,
  RenameSessionPayload,
  SetSessionLeafPayload
} from '@chaptale/ipc-contract';

export function registerSessionIpc(sessionRepository: PiSessionRepository) {
  handleTrustedIpc(IPC_CHANNELS.session.list, () => sessionRepository.list());

  handleTrustedIpc(IPC_CHANNELS.session.create, (_event, options?: CreateSessionOptions) =>
    sessionRepository.create(options)
  );

  handleTrustedIpc(IPC_CHANNELS.session.getEntries, (_event, sessionId: string) =>
    sessionRepository.getEntries(sessionId)
  );

  handleTrustedIpc(IPC_CHANNELS.session.getMessages, (_event, sessionId: string) =>
    sessionRepository.getMessages(sessionId)
  );

  handleTrustedIpc(IPC_CHANNELS.session.readImage, (_event, payload: ReadSessionImagePayload) =>
    sessionRepository.readImage(payload)
  );

  handleTrustedIpc(IPC_CHANNELS.session.rename, (_event, payload: RenameSessionPayload) =>
    sessionRepository.appendSessionInfo(payload.sessionId, payload.name)
  );

  handleTrustedIpc(IPC_CHANNELS.session.exportHtml, (_event, payload: ExportSessionPayload) =>
    exportSessionHtmlToFile(sessionRepository, payload.sessionId)
  );

  handleTrustedIpc(IPC_CHANNELS.session.delete, (_event, payload: DeleteSessionPayload) =>
    sessionRepository.delete(payload.sessionId)
  );

  handleTrustedIpc(IPC_CHANNELS.session.deleteMany, (_event, payload: DeleteSessionsPayload) =>
    sessionRepository.deleteMany(payload.sessionIds)
  );

  handleTrustedIpc(IPC_CHANNELS.session.setLeaf, (_event, payload: SetSessionLeafPayload) =>
    sessionRepository.setLeafId(payload.sessionId, payload.leafId)
  );

  handleTrustedIpc(IPC_CHANNELS.session.getStorageDebugInfo, () => sessionRepository.getStorageDebugInfo());

  handleTrustedIpc(IPC_CHANNELS.session.openStorageDir, async () => {
    await openPathOrThrow(await sessionRepository.ensureSessionDir());
  });
}
