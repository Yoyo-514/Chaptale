import type { WebContents } from 'electron';

import {
  AgentCancelArgsValidator,
  AgentClearPendingMessagesArgsValidator,
  AgentCompactSessionArgsValidator,
  AgentGetContextPressureArgsValidator,
  AgentInspectContextFilesArgsValidator,
  AgentQueueClearResultValidator,
  AgentRunResultValidator,
  AgentStartArgsValidator,
  AgentSteerArgsValidator,
  IPC_CHANNELS
} from '@chaptale/ipc-contract';
import type {
  AgentClearPendingMessagesPayload,
  AgentEndEvent,
  AgentMessageEvent,
  AgentRunScope,
  AgentRuntime,
  AgentStartPayload,
  AgentSteerPayload
} from '@chaptale/ipc-contract';
import { errorToMessage } from '@chaptale/shared';

import type { ContextFileService } from '../../core/context/service';
import type { IpcOwnerResolver } from '../../core/ipc-ports';
import { handleTrustedIpc } from '../../infra/security/trusted-ipc';
import { handleValidatedIpc } from '../../infra/security/validated-ipc';
import { AgentRunManager } from './run-manager';

class WebContentsSendError extends Error {
  constructor(readonly sendError: unknown) {
    super('向 Renderer 发送 Agent 事件失败');
  }
}

/**
 * 从活跃运行获取可信 sessionId，阻止过期 runId 被静默转为新请求。
 */
function requireActiveRun(runManager: AgentRunManager, runId: string): AgentRunScope {
  const scope = runManager.getRunScope(runId);

  if (!scope) {
    throw new Error('Agent 运行已结束，无法修改待处理消息');
  }

  return scope;
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
 * 流式 message 与唯一 end 事件只回传给发起请求的 sender，避免跨窗口泄漏执行状态。
 */
export function registerAgentIpc(options: {
  runtime: AgentRuntime;
  contextFileService: Pick<ContextFileService, 'selectFiles' | 'inspectFiles'>;
  ui: IpcOwnerResolver;
}) {
  const { runtime: agentService, contextFileService, ui } = options;
  const runManager = new AgentRunManager();

  handleTrustedIpc(IPC_CHANNELS.agent.selectContextFiles, event => {
    return contextFileService.selectFiles(ui.resolveOwner(event));
  });

  handleValidatedIpc(
    IPC_CHANNELS.agent.inspectContextFiles,
    AgentInspectContextFilesArgsValidator,
    (_event, paths: string[]) => contextFileService.inspectFiles(paths)
  );

  handleValidatedIpc(
    IPC_CHANNELS.agent.start,
    AgentStartArgsValidator,
    AgentRunResultValidator,
    (event, payload: AgentStartPayload) => {
      if (!payload.sessionId) {
        throw new Error('缺少 sessionId：Agent 流式执行需要绑定具体会话');
      }

      const signal = runManager.start(payload.runId, payload.sessionId);
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
    }
  );

  handleValidatedIpc(
    IPC_CHANNELS.agent.steer,
    AgentSteerArgsValidator,
    AgentRunResultValidator,
    async (_event, payload: AgentSteerPayload) => {
      const query = payload.query.trim();

      if (!query) {
        throw new Error('steer 内容不能为空');
      }

      const scope = requireActiveRun(runManager, payload.runId);
      await agentService.steer({ ...scope, query, contextFilePaths: payload.contextFilePaths });
      return { runId: payload.runId };
    }
  );

  handleValidatedIpc(
    IPC_CHANNELS.agent.clearPendingMessages,
    AgentClearPendingMessagesArgsValidator,
    AgentQueueClearResultValidator,
    async (_event, payload: AgentClearPendingMessagesPayload) => {
      const scope = requireActiveRun(runManager, payload.runId);
      const queue = await agentService.clearPendingMessages(scope);
      return { runId: payload.runId, queue };
    }
  );

  handleValidatedIpc(
    IPC_CHANNELS.agent.cancel,
    AgentCancelArgsValidator,
    AgentRunResultValidator,
    (_event, runId: string) => {
      runManager.cancel(runId);
      return { runId };
    }
  );

  handleValidatedIpc(
    IPC_CHANNELS.agent.getContextPressure,
    AgentGetContextPressureArgsValidator,
    (_event, sessionId: string) => agentService.getContextPressure(sessionId)
  );

  handleValidatedIpc(IPC_CHANNELS.agent.compactSession, AgentCompactSessionArgsValidator, (_event, sessionId: string) =>
    agentService.compactSession(sessionId)
  );

  /**
   * 将单次运行的异步事件流转换为带 runId 的 IPC 事件。
   * Abort、正常完成和真实异常必须保持可判别；发送通道自身失败仍交给 detached promise 回收。
   */
  async function streamAgentToRenderer(webContents: WebContents, payload: AgentStartPayload, signal: AbortSignal) {
    try {
      // start handler 已同步校验 sessionId；此处使用收窄后的值构造 Runtime 参数。
      const sessionId = payload.sessionId!;

      for await (const message of agentService.stream({
        query: payload.query,
        sessionId,
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

      safeSend(webContents, IPC_CHANNELS.agent.end, {
        runId: payload.runId,
        end: signal.aborted ? { status: 'cancelled' } : { status: 'completed' }
      } satisfies AgentEndEvent);
    } catch (error) {
      if (error instanceof WebContentsSendError) {
        throw error.sendError;
      }

      if (signal.aborted) {
        safeSend(webContents, IPC_CHANNELS.agent.end, {
          runId: payload.runId,
          end: { status: 'cancelled' }
        } satisfies AgentEndEvent);
        return;
      }

      safeSend(webContents, IPC_CHANNELS.agent.end, {
        runId: payload.runId,
        end: {
          status: 'failed',
          code: 'AGENT_RUN_FAILED',
          message: errorToMessage(error),
          retryable: false
        }
      } satisfies AgentEndEvent);
    }
  }
}
