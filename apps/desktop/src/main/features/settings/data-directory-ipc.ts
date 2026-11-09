import { IPC_CHANNELS } from '../../../bridge/channels';
import { ChooseDataDirectoryArgsValidator } from '../../../bridge/schemas/data-directory';
import type { DataDirectory } from '../../core/data-directory';
import type { UiShell } from '../../core/ipc-ports';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';

/** 数据目录的查询与选择；新位置在下次启动时生效。 */
export function registerDataDirectoryIpc(dataDirectory: DataDirectory, ui: UiShell) {
  handleTrustedIpc(IPC_CHANNELS.dataDirectory.status, () => dataDirectory.status());
  handleTrustedIpc(
    IPC_CHANNELS.dataDirectory.select,
    async event => (await ui.pickDirectory(ui.resolveOwner(event), '选择数据存放位置')) ?? null
  );
  handleValidatedIpc(IPC_CHANNELS.dataDirectory.choose, ChooseDataDirectoryArgsValidator, (_event, target: string) =>
    dataDirectory.choose(target)
  );
}
