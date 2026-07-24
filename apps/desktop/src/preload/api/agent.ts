import type { IpcRendererEvent } from 'electron';
import { ipcRenderer, webUtils } from 'electron';

import type {
  AgentClearPendingMessagesPayload,
  AgentDoneEvent,
  AgentErrorEvent,
  AgentMessageEvent,
  AgentQueueClearResult,
  AgentRunResult,
  AgentStartPayload,
  AgentSteerPayload,
  ChaptaleDesktopApi
} from '@chaptale/ipc-contract';
import { IPC_CHANNELS } from '@chaptale/ipc-contract/channels';

/**
 * 暴露 Renderer 可用的 Agent API，并在 Preload 内隔离 Electron IPC 与本地文件路径能力。
 * 每次流式运行按 runId 管理独立监听器，主进程终态或启动失败后立即释放。
 */
export function createAgentApi(): ChaptaleDesktopApi['agent'] {
  return {
    selectContextFiles: () => ipcRenderer.invoke(IPC_CHANNELS.agent.selectContextFiles),
    inspectContextFiles: (paths: string[]) => ipcRenderer.invoke(IPC_CHANNELS.agent.inspectContextFiles, paths),
    // 拖拽场景：沙盒 renderer 拿不到 File.path，必须由 preload 的 webUtils 转换。
    getPathForFile: (file: File) => webUtils.getPathForFile(file),
    stream: async (query, handlers, sessionId, options) => {
      const runId = crypto.randomUUID();

      // 每个 run 只移除自己注册的回调，避免并发流互相清理监听器。
      const cleanup = () => {
        ipcRenderer.removeListener(IPC_CHANNELS.agent.message, handleMessage);
        ipcRenderer.removeListener(IPC_CHANNELS.agent.done, handleDone);
        ipcRenderer.removeListener(IPC_CHANNELS.agent.error, handleError);
      };

      const handleMessage = (_event: IpcRendererEvent, event: AgentMessageEvent) => {
        if (event.runId === runId) {
          handlers.onMessage(event.message);
        }
      };

      const handleDone = (_event: IpcRendererEvent, event: AgentDoneEvent) => {
        if (event.runId !== runId) {
          return;
        }

        // 终态到达后立即释放三个监听器，防止后续运行重复接收事件。
        cleanup();
        handlers.onDone?.();
      };

      const handleError = (_event: IpcRendererEvent, event: AgentErrorEvent) => {
        if (event.runId !== runId) {
          return;
        }

        // error 与 done 都是终态，必须采用相同的监听器清理策略。
        cleanup();
        handlers.onError?.(event.message);
      };

      ipcRenderer.on(IPC_CHANNELS.agent.message, handleMessage);
      ipcRenderer.on(IPC_CHANNELS.agent.done, handleDone);
      ipcRenderer.on(IPC_CHANNELS.agent.error, handleError);

      try {
        await ipcRenderer.invoke(IPC_CHANNELS.agent.start, {
          runId,
          query,
          sessionId,
          branchFromEntryId: options?.branchFromEntryId,
          contextFilePaths: options?.contextFilePaths,
          reuseUserEntryId: options?.reuseUserEntryId
        } satisfies AgentStartPayload);
      } catch (error) {
        // start 未建立运行时也不会再收到终态事件，因此主动回收本次 run 的监听器。
        cleanup();
        throw error;
      }

      return { runId };
    },
    /** steer 不建立新流，只把输入转发给主进程中的活跃运行。 */
    steer: (runId, query, options) =>
      ipcRenderer.invoke(IPC_CHANNELS.agent.steer, {
        runId,
        query,
        contextFilePaths: options?.contextFilePaths
      } satisfies AgentSteerPayload) as Promise<AgentRunResult>,
    /** 清空队列由主进程和 Runtime 完成，Preload 不缓存运行状态。 */
    clearPendingMessages: runId =>
      ipcRenderer.invoke(IPC_CHANNELS.agent.clearPendingMessages, {
        runId
      } satisfies AgentClearPendingMessagesPayload) as Promise<AgentQueueClearResult>,
    getContextPressure: sessionId => ipcRenderer.invoke(IPC_CHANNELS.agent.getContextPressure, sessionId),
    compactSession: sessionId => ipcRenderer.invoke(IPC_CHANNELS.agent.compactSession, sessionId),
    cancel: (runId: string) => ipcRenderer.invoke(IPC_CHANNELS.agent.cancel, runId) as Promise<AgentRunResult>
  };
}
