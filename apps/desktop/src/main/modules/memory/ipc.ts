import { BrowserWindow } from 'electron';

import {
  IPC_CHANNELS,
  MemoryListPendingArgsValidator,
  MemoryResolvePendingArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { MemoryPendingStore } from './pending-store';

/**
 * pending 提议的查询/处理与变更通知。
 *
 * 变更由主进程内的 memory_propose 工具或确认流本身触发（没有发起方 sender），
 * changed 只作"该刷新了"的信号广播，数据由 renderer 重新拉取——避免双份状态。
 */
export type MemoryIpcOptions = {
  resolveCwd: () => Promise<string> | string;
};

export function registerMemoryIpc(pendingStore: MemoryPendingStore, options: MemoryIpcOptions): void {
  handleValidatedIpc(IPC_CHANNELS.memory.listPending, MemoryListPendingArgsValidator, async () => {
    const cwd = await options.resolveCwd();
    return pendingStore.list(cwd);
  });

  handleValidatedIpc(IPC_CHANNELS.memory.resolvePending, MemoryResolvePendingArgsValidator, async (_event, payload) => {
    const cwd = await options.resolveCwd();
    return pendingStore.resolve(cwd, payload.id, payload.action);
  });

  pendingStore.onChange(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDestroyed()) {
        continue;
      }

      try {
        window.webContents.send(IPC_CHANNELS.memory.pendingChanged);
      } catch {
        // isDestroyed 检查与 send 之间存在窗口销毁竞态；推送失败不得连带写入失败。
      }
    }
  });
}
