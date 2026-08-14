import { runAgentLoop } from '../../core/agent/engine';
import { toModelMessages } from '../../core/agent/messages';
import type { PermissionGatePort } from '../../core/agent/types';
import type { ResolvedModel } from '../../core/models/runtime';
import type { SessionMessage } from '../../core/sessions/entry';
import type { ToolDefinition } from '../../core/tool-protocol/definition';

/**
 * 一次性 task 会话端口：TaskRunner 交互面（prompt / abort / 末答 / 用量 / dispose）。
 * 不落盘（task 会话不在历史扫描范围），多轮修复在内存消息数组上继续。
 */
export type TaskSession = {
  prompt(text: string): Promise<void>;
  abort(): Promise<void>;
  getLastAssistantText(): string | undefined;
  getUsage(): { inputTokens: number; outputTokens: number };
  dispose(): void;
};

export type TaskSessionOptions = {
  sessionId: string;
  model: ResolvedModel;
  system: string;
  tools: ToolDefinition[];
  gate?: PermissionGatePort;
};

/** 自有 TaskSession：runAgentLoop 包装，每轮 prompt 追加 user 消息并驱动完整循环。 */
export function createTaskSession(options: TaskSessionOptions): TaskSession {
  const controller = new AbortController();
  const history: SessionMessage[] = [];
  let lastAssistantText: string | undefined;
  let usage = { inputTokens: 0, outputTokens: 0 };

  return {
    async prompt(text: string) {
      history.push({ role: 'user', content: text });

      const result = await runAgentLoop({
        sessionId: options.sessionId,
        model: options.model,
        system: options.system,
        messages: [...history],
        tools: options.tools,
        gate: options.gate,
        abortSignal: controller.signal,
        // 内存历史：终态后由本函数自行折叠进 history（assistant 文本 + tool 轮）。
        onStepPersist: async stepMessages => {
          for (const message of stepMessages) {
            history.push(message);
          }
        }
      });

      usage = {
        inputTokens: usage.inputTokens + result.totalUsage.inputTokens,
        outputTokens: usage.outputTokens + result.totalUsage.outputTokens
      };

      lastAssistantText = readLastAssistantText(history);
    },

    async abort() {
      controller.abort();
    },

    getLastAssistantText() {
      return lastAssistantText;
    },

    getUsage() {
      return { ...usage };
    },

    dispose() {
      controller.abort();
    }
  };
}

/** 折叠后历史里最后一条 assistant 文本（修复重试取末答的口径）。 */
function readLastAssistantText(messages: SessionMessage[]): string | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];

    if (message.role !== 'assistant') {
      continue;
    }

    if (typeof message.content === 'string') {
      return message.content || undefined;
    }

    return (
      message.content
        ?.filter(part => part.type === 'text')
        .map(part => part.text)
        .join('\n') || undefined
    );
  }

  return undefined;
}

export { toModelMessages };
