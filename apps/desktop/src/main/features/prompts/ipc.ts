import {
  IPC_CHANNELS,
  UpdatePromptSettingsArgsValidator,
  type UpdatePromptSettingsPayload
} from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { PromptFileService } from './file-service';

/**
 * 归属 Prompt 设置频道；IPC 层校验信任与参数结构，文件语义交给服务。
 * 更新成功后才触发失效回调，使既有 Agent 会话不继续使用旧提示词。
 */
export function registerPromptSettingsIpc(promptFileService: PromptFileService, onPromptChanged?: () => void) {
  handleTrustedIpc(IPC_CHANNELS.promptSettings.getState, () => promptFileService.getState());

  handleValidatedIpc(
    IPC_CHANNELS.promptSettings.update,
    UpdatePromptSettingsArgsValidator,
    async (_event, payload: UpdatePromptSettingsPayload) => {
      const state = await promptFileService.update(payload);
      onPromptChanged?.();
      return state;
    }
  );
}
