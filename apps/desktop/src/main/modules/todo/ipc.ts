import { IPC_CHANNELS, TodosGetArgsValidator } from '@chaptale/ipc-contract';
import type { TodosUpdatedEvent } from '@chaptale/ipc-contract';
import { BrowserWindow } from 'electron';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { TodoStore } from './store';

/**
 * todo 清单的查询与变更推送。
 *
 * 变更由主进程内的工具执行触发（没有发起方 sender），因此广播给所有存活窗口，
 * renderer 侧按 sessionId 过滤自己关心的清单。
 */
export function registerTodoIpc(todoStore: TodoStore): void {
  handleValidatedIpc(IPC_CHANNELS.todos.get, TodosGetArgsValidator, async (_event, sessionId) => {
    return todoStore.read(sessionId);
  });

  todoStore.onChange((sessionId, items) => {
    const event: TodosUpdatedEvent = { sessionId, items };

    for (const window of BrowserWindow.getAllWindows()) {
      if (window.webContents.isDestroyed()) {
        continue;
      }

      try {
        window.webContents.send(IPC_CHANNELS.todos.updated, event);
      } catch {
        // isDestroyed 检查与 send 之间存在窗口销毁竞态；推送失败不得连带 todo_write 工具执行失败。
      }
    }
  });
}
