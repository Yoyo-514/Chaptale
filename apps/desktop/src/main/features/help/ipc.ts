import { app, net } from 'electron';
import { release, type } from 'node:os';

import { homepage } from '../../../../package.json';
import { IPC_CHANNELS } from '../../../bridge/channels';
import type { AppAboutInfo } from '../../../bridge/help';
import type { SettingsService } from '../../core/settings/service';
import { openExternalUrl } from '../../infra/electron/external-link';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { createUpdateChecker } from './updates';

export function registerHelpIpc(settings: SettingsService) {
  const version = app.getVersion();
  const about: AppAboutInfo = {
    version,
    versionText: `Chaptale ${version}\n${type()} ${release()} (${process.arch})`
  };
  const updates = createUpdateChecker({
    currentVersion: version,
    repository: homepage,
    endpoint: `https://api.github.com/repos${new URL(homepage).pathname}/releases/latest`,
    request: (url, init) => net.fetch(url, init),
    settings
  });
  const channels = IPC_CHANNELS.help;
  handleTrustedIpc(channels.getAbout, () => about);
  handleTrustedIpc(channels.reportIssue, () => {
    const url = new URL(`${homepage}/issues/new`);
    url.searchParams.set(
      'body',
      `## 问题描述\n\n## 复现步骤\n\n## 版本信息\n\n\`\`\`text\n${about.versionText}\n\`\`\`\n`
    );
    return openExternalUrl(url.href);
  });
  handleTrustedIpc(channels.getUpdateState, updates.getState);
  handleTrustedIpc(channels.checkUpdate, updates.check);
}
