import { IPC_CHANNELS } from '@chaptale/ipc-contract';

import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import type { SlashCommandService } from './service';

/** 归属斜杠命令查询频道；IPC 层校验 sender 信任，命令描述的聚合语义由服务负责。 */
export function registerSlashCommandIpc(slashCommandService: SlashCommandService) {
  handleTrustedIpc(IPC_CHANNELS.slashCommands.list, () => slashCommandService.list());
}
