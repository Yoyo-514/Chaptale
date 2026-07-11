import { IPC_CHANNELS } from '@chaptale/ipc-contract';
import { errorToMessage } from '@chaptale/shared';
import { BrowserWindow } from 'electron';
import { handleTrustedIpc } from '../security/trusted-ipc';
import { ContextFileService } from '../services/context-file.service';
import { PiAgentService } from '../services/pi-agent.service';

import type { AgentDoneEvent, AgentErrorEvent, AgentMessageEvent, AgentStartPayload } from '@chaptale/ipc-contract';
import type { WebContents } from 'electron';

export function registerAgentIpc(agentService: PiAgentService) {
  const controllers = new Map<string, AbortController>();
  const contextFileService = new ContextFileService();

  handleTrustedIpc(IPC_CHANNELS.agent.selectContextFiles, event => {
    return contextFileService.selectFiles(BrowserWindow.fromWebContents(event.sender));
  });

  handleTrustedIpc(IPC_CHANNELS.agent.inspectContextFiles, (_event, paths: string[]) => {
    return contextFileService.inspectFiles(Array.isArray(paths) ? paths : []);
  });

  handleTrustedIpc(IPC_CHANNELS.agent.start, (event, payload: AgentStartPayload) => {
    const abortController = new AbortController();
    controllers.set(payload.runId, abortController);

    // Agent 流在主进程内执行，Renderer 只接收结构化事件，不直接接触模型密钥和本地服务。
    void streamAgentToRenderer(event.sender, payload, abortController).finally(() => {
      controllers.delete(payload.runId);
    });

    return { runId: payload.runId };
  });

  handleTrustedIpc(IPC_CHANNELS.agent.cancel, (_event, runId: string) => {
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
      if (!payload.sessionId) {
        throw new Error('缺少 sessionId：Agent 流式执行需要绑定具体会话');
      }

      for await (const message of agentService.stream({
        query: payload.query,
        sessionId: payload.sessionId,
        branchFromEntryId: payload.branchFromEntryId,
        contextFilePaths: payload.contextFilePaths,
        reuseUserEntryId: payload.reuseUserEntryId,
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
        message: errorToMessage(error)
      } satisfies AgentErrorEvent);
    }
  }
}
