import { IPC_CHANNELS, type AppPlatformResult } from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../infra/security/trusted-ipc';
import { registerAgentIpc } from '../modules/agent/ipc';
import { registerSlashCommandIpc } from '../modules/commands/ipc';
import { registerMemoryIpc } from '../modules/memory/ipc';
import { registerModelsIpc } from '../modules/models/ipc';
import { registerPermissionsIpc } from '../modules/permissions/ipc';
import { registerPromptSettingsIpc } from '../modules/prompts/ipc';
import { registerSessionIpc } from '../modules/sessions/ipc';
import { registerSettingsIpc } from '../modules/settings/ipc';
import { registerSubagentIpc } from '../modules/subagent/ipc';
import { registerTaskIpc } from '../modules/tasks/ipc';
import { registerTodoIpc } from '../modules/todo/ipc';
import { registerWindowIpc } from '../modules/window/ipc';
import type { AppContext } from './app-context';

/**
 * Renderer → Main 请求频道的唯一装配入口。
 *
 * 所有模块共享同一个 AppContext 实例并只在应用启动时注册一次，避免服务状态分裂或频道重复注册。
 */
export function registerApplicationIpc(context: AppContext): void {
  handleTrustedIpc(
    IPC_CHANNELS.app.getPlatform,
    () =>
      ({
        platform: process.platform,
        versions: Object.fromEntries(
          Object.entries(process.versions).filter((entry): entry is [string, string] => entry[1] !== undefined)
        )
      }) satisfies AppPlatformResult
  );

  registerSessionIpc(context.sessionRepository, {
    onSessionsDeleted: sessionIds => {
      for (const sessionId of sessionIds) {
        void context.todoStore.remove(sessionId).catch(() => undefined);
        // 会话删除后释放其挂起的授权请求与会话级规则。
        context.permissionBroker.rejectSession(sessionId);
        context.permissionRuleStore.clearSession(sessionId);
      }
    }
  });
  registerSettingsIpc(context.settingsService, () => context.agentRuntime.invalidateSessions());
  registerPromptSettingsIpc(context.promptFileService, () => context.agentRuntime.invalidateSessions());
  registerModelsIpc(context.modelService);
  registerAgentIpc(context.agentRuntime);
  registerSlashCommandIpc(context.commandService);
  registerTaskIpc(context.taskService, context.runStore);
  registerTodoIpc(context.todoStore);
  registerSubagentIpc(context.subagentPool);
  registerMemoryIpc(context.memoryPendingStore);
  registerPermissionsIpc(context.permissionBroker, context.permissionRuleStore, {
    resolveCwd: context.getPermissionSettingsCwd
  });
  registerWindowIpc();
}
