import { IPC_CHANNELS, type UpdatePromptSettingsPayload } from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../security/trusted-ipc';
import type { PromptFileService } from '../services/prompts/prompt-file.service';

export function registerPromptSettingsIpc(promptFileService: PromptFileService, onPromptChanged?: () => void) {
  handleTrustedIpc(IPC_CHANNELS.promptSettings.getState, () => promptFileService.getState());

  handleTrustedIpc(IPC_CHANNELS.promptSettings.update, async (_event, payload: UpdatePromptSettingsPayload) => {
    const state = await promptFileService.update(payload);
    onPromptChanged?.();
    return state;
  });
}
