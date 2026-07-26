import {
  IPC_CHANNELS,
  TaskCancelArgsValidator,
  TaskListRunsArgsValidator,
  TaskReadRunOutputArgsValidator,
  TaskRunArgsValidator
} from '@chaptale/ipc-contract';

import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import type { AgentRunStore } from '../runs/store';
import type { TaskService } from './service';

export function registerTaskIpc(taskService: TaskService, runStore: AgentRunStore): void {
  handleValidatedIpc(IPC_CHANNELS.tasks.run, TaskRunArgsValidator, async (_event, payload) => {
    // 审查类任务是短任务，直接 await 结果随 invoke 返回；
    // 未来长任务需要进度推送时，再改为事件通道模式。
    return taskService.start(payload);
  });

  handleValidatedIpc(IPC_CHANNELS.tasks.cancel, TaskCancelArgsValidator, async (_event, payload) => {
    taskService.cancel(payload.requestId);
  });

  handleValidatedIpc(IPC_CHANNELS.tasks.listRuns, TaskListRunsArgsValidator, async (_event, payload) => {
    return runStore.list(payload);
  });

  handleValidatedIpc(IPC_CHANNELS.tasks.readRunOutput, TaskReadRunOutputArgsValidator, async (_event, outputRef) => {
    return runStore.readOutput(outputRef);
  });
}
