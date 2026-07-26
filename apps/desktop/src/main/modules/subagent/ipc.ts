import { IPC_CHANNELS, SubagentCancelArgsValidator, SubagentListActiveArgsValidator } from '@chaptale/ipc-contract';
import type { SubagentSlotEvent } from '@chaptale/shared';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { IpcBroadcaster } from '../ipc-ports';
import type { SubagentPool } from './pool';

/**
 * 子任务槽位的查询/取消与状态机事件推送。
 *
 * 事件由主进程内的 delegate 工具执行触发（没有发起方 sender），
 * 广播给所有存活窗口，renderer 侧按 sessionId 过滤自己关心的子任务。
 */
export function registerSubagentIpc(pool: SubagentPool, ui: IpcBroadcaster): void {
  handleValidatedIpc(IPC_CHANNELS.subagent.listActive, SubagentListActiveArgsValidator, async (_event, sessionId) => {
    return pool.listActive(sessionId);
  });

  handleValidatedIpc(IPC_CHANNELS.subagent.cancel, SubagentCancelArgsValidator, async (_event, requestId) => {
    pool.cancel(requestId);
  });

  pool.onEvent((event: SubagentSlotEvent) => {
    ui.broadcast(IPC_CHANNELS.subagent.event, event);
  });
}
