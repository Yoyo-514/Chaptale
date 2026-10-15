import type { ExtensionFactory, ToolDefinition } from '@earendil-works/pi-coding-agent';

/** 只传递本次授权所需的数据，不把带模型与凭据的 SDK context 交给界面。 */
export interface HostToolRequest {
  sessionId: string;
  cwd: string;
  toolCallId: string;
  toolName: string;
  input: unknown;
}

export type HostToolDecision = { allow: true } | { allow: false; reason?: string };
export type HostToolAuthorizer = (
  request: HostToolRequest,
  signal: AbortSignal | undefined
) => Promise<HostToolDecision>;

export interface HostToolAccess {
  /** 直接使用 pi 工具声明；业务参数、返回值和嵌套执行不转换为另一套协议。 */
  tools: ToolDefinition[];
  /** 每次实际执行重新求值；父工具获准不代表嵌套调用获准。 */
  authorize: HostToolAuthorizer;
}

function aborted(): Error {
  return new DOMException('工具调用已取消', 'AbortError');
}

/** 授权界面即使没有响应取消，也不能在稍后批准时执行已经取消的工具。 */
function authorizeCall(
  authorize: HostToolAuthorizer,
  request: HostToolRequest,
  signal: AbortSignal | undefined
): Promise<HostToolDecision> {
  return new Promise((resolve, reject) => {
    const finish = (action: () => void) => {
      signal?.removeEventListener('abort', onAbort);
      action();
    };
    const onAbort = () => finish(() => reject(aborted()));
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) {
      onAbort();
      return;
    }
    Promise.resolve()
      .then(() => {
        if (signal?.aborted) throw aborted();
        return authorize(request, signal);
      })
      .then(
        decision => finish(() => resolve(decision)),
        () => finish(() => reject(new Error('工具授权失败，未执行工具')))
      );
  });
}

export function bindHostTools(access: HostToolAccess): {
  tools: ToolDefinition[];
  names: string[];
  guard: ExtensionFactory;
} {
  const names = access.tools.map(tool => tool.name);
  if (
    names.some(name => !name || name.trim() !== name || name.includes('*') || /^[+-]/.test(name)) ||
    new Set(names).size !== names.length
  ) {
    throw new Error('工具名必须唯一且不能包含 SDK 选择器通配符或修饰前缀');
  }
  const registered = new Set(names);
  return {
    names,
    tools: access.tools.map(tool => ({
      ...tool,
      async execute(toolCallId, params, signal, onUpdate, ctx) {
        if (signal?.aborted) throw aborted();
        const decision = await authorizeCall(
          access.authorize,
          {
            sessionId: ctx.sessionManager.getSessionId(),
            cwd: ctx.cwd,
            toolCallId,
            toolName: tool.name,
            // 授权流程只能查看快照，不能意外改写马上执行的实参。
            input: structuredClone(params)
          },
          signal
        );
        if (signal?.aborted) throw aborted();
        if (decision?.allow !== true) {
          throw new Error(decision?.reason || '工具调用未获授权');
        }
        return tool.execute(toolCallId, params, signal, onUpdate, ctx);
      }
    })),
    // 激活原生内置工具不等于应用授予了执行权；未显式注册的工具一律阻断。
    guard: pi => {
      pi.on('tool_call', event => {
        if (!registered.has(event.toolName)) return { block: true, reason: '工具未在应用宿主中授权注册' };
      });
    }
  };
}
