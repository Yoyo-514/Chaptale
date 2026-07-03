import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { ipcMain } from 'electron';
import { AgentService } from '../services/agent.service';
import { ContextService } from '../services/context.service';

import type { AgentDoneEvent, AgentErrorEvent, AgentMessageEvent, AgentStartPayload } from '@chaptale/ipc-contract';
import type { WebContents } from 'electron';

export function registerAgentIpc(agentService: AgentService, contextService: ContextService) {
  const controllers = new Map<string, AbortController>();

  ipcMain.handle(IPC_CHANNELS.agent.getHistory, () => contextService.getMessages());

  ipcMain.handle(IPC_CHANNELS.agent.start, (event, payload: AgentStartPayload) => {
    const abortController = new AbortController();
    controllers.set(payload.runId, abortController);

    // Agent 流在主进程内执行，Renderer 只接收结构化事件，不直接接触模型密钥和本地服务。
    void streamAgentToRenderer(event.sender, payload, abortController).finally(() => {
      controllers.delete(payload.runId);
    });

    return { runId: payload.runId };
  });

  ipcMain.handle(IPC_CHANNELS.agent.cancel, (_event, runId: string) => {
    controllers.get(runId)?.abort();
    controllers.delete(runId);
    return { runId };
  });

  async function streamAgentToRenderer(
    webContents: WebContents,
    payload: AgentStartPayload,
    abortController: AbortController
  ) {
    try {
      for await (const message of agentService.stream({
        query: payload.query,
        signal: abortController.signal
      })) {
        webContents.send(IPC_CHANNELS.agent.message, {
          runId: payload.runId,
          message
        } satisfies AgentMessageEvent);
      }

      webContents.send(IPC_CHANNELS.agent.done, {
        runId: payload.runId
      } satisfies AgentDoneEvent);
    } catch (error) {
      if (abortController.signal.aborted) {
        webContents.send(IPC_CHANNELS.agent.done, {
          runId: payload.runId
        } satisfies AgentDoneEvent);
        return;
      }

      webContents.send(IPC_CHANNELS.agent.error, {
        runId: payload.runId,
        message: error instanceof Error ? error.message : String(error)
      } satisfies AgentErrorEvent);
    }
  }
}
