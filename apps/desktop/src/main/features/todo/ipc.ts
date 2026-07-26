import { IPC_CHANNELS, TodosGetArgsValidator } from '@chaptale/ipc-contract';
import type { TodosUpdatedEvent } from '@chaptale/ipc-contract';

import type { IpcBroadcaster } from '../../core/ipc-ports';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { TodoStore } from './store';

/**
 * todo 清单的查询与变更推送。
 *
 * 变更由主进程内的工具执行触发（没有发起方 sender），因此广播给所有存活窗口，
 * renderer 侧按 sessionId 过滤自己关心的清单。
 */
export function registerTodoIpc(todoStore: TodoStore, ui: IpcBroadcaster): void {
  handleValidatedIpc(IPC_CHANNELS.todos.get, TodosGetArgsValidator, async (_event, sessionId) => {
    return todoStore.read(sessionId);
  });

  todoStore.onChange((sessionId, items) => {
    ui.broadcast(IPC_CHANNELS.todos.updated, { sessionId, items } satisfies TodosUpdatedEvent);
  });
}
