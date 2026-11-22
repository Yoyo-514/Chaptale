import { app, type IpcMainInvokeEvent } from 'electron';
import { join } from 'node:path';

import { IPC_CHANNELS } from '../../../bridge/channels';
import type { ScheduledBackupPatch, ScheduledBackupSettings } from '../../../bridge/scheduled-backup';
import { ScheduledBackupUpdateArgsValidator } from '../../../bridge/schemas/scheduled-backup';
import type { UiShell } from '../../core/ipc-ports';
import type { SettingsService } from '../../core/settings/service';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { ScheduledWorkBackups } from './scheduled';

export function registerScheduledBackupIpc(scheduled: ScheduledWorkBackups, settings: SettingsService, ui: UiShell) {
  const channels = IPC_CHANNELS.scheduledBackup;
  const pickDirectory = (event: IpcMainInvokeEvent, current: ScheduledBackupSettings) =>
    ui.pickDirectory(
      ui.resolveOwner(event),
      '选择备份文件夹',
      current.directory ?? join(app.getPath('documents'), 'Chaptale 备份')
    );

  handleTrustedIpc(channels.getState, () => scheduled.getState());
  handleValidatedIpc(
    channels.update,
    ScheduledBackupUpdateArgsValidator,
    async (event, patch: ScheduledBackupPatch) => {
      const next = { ...(await settings.readScheduledBackup()), ...patch };
      if (next.enabled && !next.directory) {
        const directory = await pickDirectory(event, next);
        if (!directory) return scheduled.getState();
        next.directory = directory;
      }
      return scheduled.configure(next);
    }
  );
  handleTrustedIpc(channels.chooseDirectory, async event => {
    const current = await settings.readScheduledBackup();
    const directory = await pickDirectory(event, current);
    return directory ? scheduled.configure({ ...current, directory }) : scheduled.getState();
  });
  handleTrustedIpc(channels.openDirectory, async () => {
    const { directory } = await settings.readScheduledBackup();
    if (!directory) throw new Error('请先选择备份文件夹');
    await ui.openPath(directory);
  });
  handleTrustedIpc(channels.backupNow, async event => {
    const current = await settings.readScheduledBackup();
    if (!current.directory) {
      const directory = await pickDirectory(event, current);
      if (!directory) return null;
      // 只记下文件夹，定时备份保持原来的开关。
      await scheduled.configure({ ...current, directory });
    }
    return scheduled.runOnce({ upload: true, manual: true });
  });
  handleTrustedIpc(channels.pickBackup, async event => {
    const { directory } = await settings.readScheduledBackup();
    const path = await ui.pickFile(ui.resolveOwner(event), {
      title: '从本机备份恢复',
      defaultPath: directory ?? undefined,
      filters: [{ name: 'Chaptale 作品包', extensions: ['chaptale'] }]
    });
    return path ?? null;
  });
}
