import { IPC_CHANNELS } from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../security/trusted-ipc';
import type { SlashCommandService } from '../services/slash-command.service';

export function registerSlashCommandIpc(slashCommandService: SlashCommandService) {
  handleTrustedIpc(IPC_CHANNELS.slashCommands.list, () => slashCommandService.list());
}
