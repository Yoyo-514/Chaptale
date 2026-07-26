import { SessionManager, type SessionInfo } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unique } from 'radash';

import type { SessionCtx } from '../../../core/session-ctx/types';
import type { SettingsService } from '../../../core/settings/service';
import { getSessionScope } from '../sessions/storage';

/** 从持久化 session 元数据恢复安全上下文，拒绝缺失 cwd 的历史会话。 */
export function createSessionCtx(sessionId: string, target: SessionInfo): SessionCtx {
  if (!target.cwd?.trim()) {
    throw new Error(`会话缺少 workspace，无法安全恢复：${sessionId}`);
  }

  return {
    sessionId,
    cwd: target.cwd,
    scope: getSessionScope(path.dirname(target.path))
  };
}

export async function findSessionById(
  settingsService: SettingsService,
  sessionId: string
): Promise<SessionInfo | undefined> {
  const sessionDirs = await getKnownSessionDirs(settingsService);

  for (const sessionDir of sessionDirs) {
    const sessions = await SessionManager.listAll(sessionDir);
    const target = sessions.find(item => item.id === sessionId);

    if (target) {
      return target;
    }
  }

  return undefined;
}

export async function getKnownSessionDirs(settingsService: SettingsService): Promise<string[]> {
  const currentSessionDir = await settingsService.getCurrentSessionDir();
  await fs.mkdir(settingsService.sessionsRootDir, { recursive: true });

  const entries = await fs.readdir(settingsService.sessionsRootDir, { withFileTypes: true });
  const dirs = entries
    .filter(entry => entry.isDirectory())
    .map(entry => path.join(settingsService.sessionsRootDir, entry.name));

  return unique([currentSessionDir, ...dirs]);
}
