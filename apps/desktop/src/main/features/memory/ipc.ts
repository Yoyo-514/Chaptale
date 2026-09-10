import {
  IPC_CHANNELS,
  MemoryListPendingArgsValidator,
  MemoryInspectPendingArgsValidator,
  MemoryResolvePendingArgsValidator
} from '@chaptale/ipc-contract';

import type { IpcBroadcaster } from '../../core/ipc-ports';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { MemoryPendingStore } from './pending/store';

/**
 * pending 提议的查询/处理与变更通知。
 *
 * 变更由主进程内的 memory_propose 工具或确认流本身触发（没有发起方 sender），
 * changed 只作"该刷新了"的信号广播，数据由 renderer 重新拉取——避免双份状态。
 */
export type MemoryIpcOptions = {
  resolveCwd: () => Promise<string> | string;
};

export function registerMemoryIpc(
  pendingStore: MemoryPendingStore,
  ui: IpcBroadcaster,
  options: MemoryIpcOptions
): void {
  handleValidatedIpc(IPC_CHANNELS.memory.listPending, MemoryListPendingArgsValidator, async () => {
    const cwd = await options.resolveCwd();
    return pendingStore.list(cwd);
  });

  handleValidatedIpc(IPC_CHANNELS.memory.resolvePending, MemoryResolvePendingArgsValidator, async (_event, payload) => {
    const cwd = await options.resolveCwd();
    if (payload.rootPath && payload.rootPath !== cwd) throw new Error('作品已切换');
    return pendingStore.resolve(cwd, payload.id, payload.action, payload.expectedProposalHash);
  });
  handleValidatedIpc(IPC_CHANNELS.memory.inspectPending, MemoryInspectPendingArgsValidator, async (_event, payload) => {
    const cwd = await options.resolveCwd();
    if (payload.rootPath && payload.rootPath !== cwd) throw new Error('作品已切换');
    return pendingStore.inspect(cwd, payload.id);
  });

  pendingStore.onChange(() => {
    ui.broadcast(IPC_CHANNELS.memory.pendingChanged);
  });
}
