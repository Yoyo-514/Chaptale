import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { dialog, shell } from 'electron';
import { promises as fs } from 'node:fs';
import { handleTrustedIpc } from '../security/trusted-ipc';
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

  handleTrustedIpc(IPC_CHANNELS.session.exportHtml, async (_event, payload: ExportSessionPayload) => {
    const { html, suggestedFileName } = await sessionRepository.exportHtml(payload.sessionId);
    const result = await dialog.showSaveDialog({
      title: '导出会话为 HTML',
      defaultPath: suggestedFileName,
      filters: [
        { name: 'HTML', extensions: ['html'] },
        { name: '所有文件', extensions: ['*'] }
      ]
    });

    if (result.canceled || !result.filePath) {
      return null;
    }

    await fs.writeFile(result.filePath, html, 'utf8');
    return result.filePath;
  });

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
    const sessionDir = await sessionRepository.ensureSessionDir();
    const errorMessage = await shell.openPath(sessionDir);

    if (errorMessage) {
      throw new Error(errorMessage);
    }
  });
}
