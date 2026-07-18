import { IPC_CHANNELS, type AppPlatformResult } from '@chaptale/ipc-contract';
import { registerAgentIpc } from '../modules/agent/ipc';
import { registerSlashCommandIpc } from '../modules/commands/ipc';
import { registerModelsIpc } from '../modules/models/ipc';
import { registerPromptSettingsIpc } from '../modules/prompts/ipc';
import { registerSessionIpc } from '../modules/sessions/ipc';
import { registerSettingsIpc } from '../modules/settings/ipc';
import { registerWindowIpc } from '../modules/window/ipc';
import { handleTrustedIpc } from '../infra/security/trusted-ipc';
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

  registerSessionIpc(context.sessionRepository);
  registerSettingsIpc(context.settingsService, () => context.agentRuntime.invalidateSessions());
  registerPromptSettingsIpc(context.promptFileService, () => context.agentRuntime.invalidateSessions());
  registerModelsIpc(context.modelService);
  registerAgentIpc(context.agentRuntime);
  registerSlashCommandIpc(context.commandService);
  registerWindowIpc();
}
