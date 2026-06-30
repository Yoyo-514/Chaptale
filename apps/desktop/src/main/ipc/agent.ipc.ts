import { ipcMain, type WebContents } from 'electron';
import type { ChatMessage } from '@chaptale/shared';
import { AgentService } from '../services/agent.service';
import { ContextService } from '../services/context.service';

export type AgentStartPayload = {
  runId: string;
  query: string;
};

export type AgentMessageEvent = {
  runId: string;
  message: ChatMessage;
};

export type AgentDoneEvent = {
  runId: string;
};

export type AgentErrorEvent = {
  runId: string;
  message: string;
};

export function registerAgentIpc(agentService: AgentService, contextService: ContextService) {
  const controllers = new Map<string, AbortController>();

  ipcMain.handle('agent:get-history', () => contextService.getMessages());

  ipcMain.handle('agent:start', (event, payload: AgentStartPayload) => {
    const abortController = new AbortController();
    controllers.set(payload.runId, abortController);

    // Agent 流在主进程内执行，Renderer 只接收结构化事件，不直接接触模型密钥和本地服务。
    void streamAgentToRenderer(event.sender, payload, abortController).finally(() => {
      controllers.delete(payload.runId);
    });

    return { runId: payload.runId };
  });

  ipcMain.handle('agent:cancel', (_event, runId: string) => {
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
        webContents.send('agent:message', {
          runId: payload.runId,
          message
        } satisfies AgentMessageEvent);
      }

      webContents.send('agent:done', {
        runId: payload.runId
      } satisfies AgentDoneEvent);
    } catch (error) {
      if (abortController.signal.aborted) {
        webContents.send('agent:done', {
          runId: payload.runId
        } satisfies AgentDoneEvent);
        return;
      }

      webContents.send('agent:error', {
        runId: payload.runId,
        message: error instanceof Error ? error.message : String(error)
      } satisfies AgentErrorEvent);
    }
  }
}
