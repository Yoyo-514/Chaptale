import { IPC_CHANNELS, type AppPlatformResult } from '@chaptale/ipc-contract';

import { registerSettingsIpc } from '../core/settings/ipc';
import { registerAgentIpc } from '../features/agent/ipc';
import { registerSlashCommandIpc } from '../features/commands/ipc';
import { registerMemoryIpc } from '../features/memory/ipc';
import { registerModelsIpc } from '../features/models/ipc';
import { registerPermissionsIpc } from '../features/permissions/ipc';
import { registerPromptSettingsIpc } from '../features/prompts/ipc';
import { registerSessionIpc } from '../features/sessions/ipc';
import { registerSubagentIpc } from '../features/subagent/ipc';
import { registerTaskIpc } from '../features/tasks/ipc';
import { registerTodoIpc } from '../features/todo/ipc';
import { ElectronUiShell } from '../infra/electron/ui-shell';
import { registerWindowIpc } from '../infra/electron/window-ipc';
import { handleTrustedIpc } from '../infra/security/trusted-ipc';
import type { AppContext } from './app-context';

/**
 * Renderer → Main 请求频道的唯一装配入口。
 *
 * 所有模块共享同一个 AppContext 实例并只在应用启动时注册一次，避免服务状态分裂或频道重复注册。
 */
export function registerApplicationIpc(context: AppContext): void {
  const ui = new ElectronUiShell();

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

  registerSessionIpc(context.sessionRepository, ui, {
    onSessionsDeleted: sessionIds => {
      for (const sessionId of sessionIds) {
        void context.todoStore.remove(sessionId).catch(() => undefined);
        // 会话删除后释放其挂起的授权请求与会话级规则。
        context.permissionBroker.rejectSession(sessionId);
        context.permissionRuleStore.clearSession(sessionId);
      }
    }
  });
  registerSettingsIpc(context.settingsService, ui, () => context.agentRuntime.invalidateSessions());
  registerPromptSettingsIpc(context.promptFileService, () => context.agentRuntime.invalidateSessions());
  registerModelsIpc(context.modelService);
  registerAgentIpc({ runtime: context.agentRuntime, contextFileService: context.contextFileService, ui });
  registerSlashCommandIpc(context.commandService);
  registerTaskIpc(context.taskService, context.runStore);
  registerTodoIpc(context.todoStore, ui);
  registerSubagentIpc(context.subagentPool, ui);
  registerMemoryIpc(context.memoryPendingStore, ui, { resolveCwd: context.getMemoryPendingCwd });
  registerPermissionsIpc(context.permissionBroker, context.permissionRuleStore, ui, {
    resolveCwd: context.getPermissionSettingsCwd
  });
  registerWindowIpc();
}
