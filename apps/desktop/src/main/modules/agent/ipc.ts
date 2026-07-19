import {
  AgentCancelArgsValidator,
  AgentInspectContextFilesArgsValidator,
  AgentStartArgsValidator,
  IPC_CHANNELS
} from '@chaptale/ipc-contract';
import { errorToMessage } from '@chaptale/shared';
import { BrowserWindow } from 'electron';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import { ContextFileService } from '../context/service';
import { AgentRunManager } from './run-manager';

import type { AgentDoneEvent, AgentErrorEvent, AgentMessageEvent, AgentStartPayload } from '@chaptale/ipc-contract';
import type { AgentRuntime } from './runtime';
import type { WebContents } from 'electron';

class WebContentsSendError extends Error {
  constructor(readonly sendError: unknown) {
    super('向 Renderer 发送 Agent 事件失败');
  }
}

function safeSend(webContents: WebContents, channel: string, payload: unknown): boolean {
  if (webContents.isDestroyed()) {
    return false;
  }

  try {
    webContents.send(channel, payload);
    return true;
  } catch (error) {
    // 封闭 isDestroyed 检查与 send 之间的销毁竞态；其余发送错误交给 detached rejection 终点。
    if (webContents.isDestroyed()) {
      return false;
    }

    throw new WebContentsSendError(error);
  }
}

/**
 * 归属 Agent 的启动、取消与上下文文件频道；IPC 层负责信任及参数结构校验，运行语义交给 AgentRuntime。
 * 流式 message、done、error 事件只回传给发起请求的 sender，避免跨窗口泄漏执行状态。
 */
export function registerAgentIpc(agentService: AgentRuntime) {
  const runManager = new AgentRunManager();
  const contextFileService = new ContextFileService();

  handleTrustedIpc(IPC_CHANNELS.agent.selectContextFiles, event => {
    return contextFileService.selectFiles(BrowserWindow.fromWebContents(event.sender));
  });

  handleValidatedIpc(
    IPC_CHANNELS.agent.inspectContextFiles,
    AgentInspectContextFilesArgsValidator,
    (_event, paths: string[]) => contextFileService.inspectFiles(paths)
  );

  handleValidatedIpc(IPC_CHANNELS.agent.start, AgentStartArgsValidator, (event, payload: AgentStartPayload) => {
    const signal = runManager.start(payload.runId);
    const onDestroyed = () => {
      runManager.cancel(payload.runId);
    };
    event.sender.once('destroyed', onDestroyed);

    if (event.sender.isDestroyed()) {
      onDestroyed();
    }

    // Agent 流在主进程内执行，Renderer 只接收结构化事件，不直接接触模型密钥和本地服务。
    void streamAgentToRenderer(event.sender, payload, signal)
      .finally(() => {
        event.sender.removeListener('destroyed', onDestroyed);
        runManager.finish(payload.runId);
      })
      .catch(() => undefined);

    return { runId: payload.runId };
  });

  handleValidatedIpc(IPC_CHANNELS.agent.cancel, AgentCancelArgsValidator, (_event, runId: string) => {
    runManager.cancel(runId);
    return { runId };
  });

  /**
   * 将单次运行的异步事件流转换为带 runId 的 IPC 事件。
   * Abort 被视为正常终态并发送 done；发送通道自身失败则向外抛出，由 detached promise 统一回收。
   */
  async function streamAgentToRenderer(webContents: WebContents, payload: AgentStartPayload, signal: AbortSignal) {
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
        signal
      })) {
        const sent = safeSend(webContents, IPC_CHANNELS.agent.message, {
          runId: payload.runId,
          message
        } satisfies AgentMessageEvent);

        if (!sent) {
          return;
        }
      }

      safeSend(webContents, IPC_CHANNELS.agent.done, {
        runId: payload.runId
      } satisfies AgentDoneEvent);
    } catch (error) {
      if (error instanceof WebContentsSendError) {
        throw error.sendError;
      }

      if (signal.aborted) {
        safeSend(webContents, IPC_CHANNELS.agent.done, {
          runId: payload.runId
        } satisfies AgentDoneEvent);
        return;
      }

      safeSend(webContents, IPC_CHANNELS.agent.error, {
        runId: payload.runId,
        message: errorToMessage(error)
      } satisfies AgentErrorEvent);
    }
  }
}
