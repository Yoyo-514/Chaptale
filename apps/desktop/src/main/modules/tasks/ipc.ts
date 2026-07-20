import {
  IPC_CHANNELS,
  TaskCancelArgsValidator,
  TaskListRunsArgsValidator,
  TaskRunArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { TaskService } from './service';
import type { AgentRunStore } from '../runs/store';

export function registerTaskIpc(taskService: TaskService, runStore: AgentRunStore): void {
  handleValidatedIpc(IPC_CHANNELS.tasks.run, TaskRunArgsValidator, async (_event, payload) => {
    const handle = await taskService.start(payload.personaId, payload.brief, payload.text, payload.contextFilePaths);

    // 审查类任务是短任务，直接 await 结果随 invoke 返回；
    // 未来长任务需要进度推送时，再改为 runId + 事件通道模式。
    const result = await handle.promise;
    return { runId: handle.runId, ...result };
  });

  handleValidatedIpc(IPC_CHANNELS.tasks.cancel, TaskCancelArgsValidator, async (_event, payload) => {
    taskService.cancel(payload.runId);
  });

  handleValidatedIpc(IPC_CHANNELS.tasks.listRuns, TaskListRunsArgsValidator, async (_event, payload) => {
    return runStore.list(payload);
  });
}
