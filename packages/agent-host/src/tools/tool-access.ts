import {
  createToolSearchExtension,
  type ExtensionFactory,
  type ToolCallEvent,
  type ToolResultEvent,
  type ToolDefinition
} from '@earendil-works/pi-coding-agent';

import { isMcpToolName, sessionMcpToolNames } from '../mcp/index.ts';
import { codemodeToolName, createHostCodemodeExtension, type HostCodemodeOptions } from './codemode.ts';

const toolSearchName = 'tool_search';
const reservedToolNames = new Set([toolSearchName, codemodeToolName]);

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
  /** 原生 Code Mode 单次脚本的默认与最大超时覆盖。 */
  codemode?: HostCodemodeOptions;
  /** 会话的 MCP 扩展；其工具由 pi 注册，每次直接或嵌套调用同样经过 authorize。 */
  mcpExtensions?: ExtensionFactory[];
  /** 可声明的工具可能变化后调用（tool_search 加载、MCP 工具随连接注册），宿主据此按会话状态校正声明的工具。 */
  onToolsLoaded?: (sessionId: string) => void;
  /** 原生事件只用于应用展示，执行与嵌套记录继续由 SDK 持有。 */
  onToolActivity?: (sessionId: string, event: ToolCallEvent | ToolResultEvent) => void;
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
  deferred: Set<string>;
  extensions: ExtensionFactory[];
} {
  const names = access.tools.map(tool => tool.name);
  if (
    names.some(
      name =>
        !name ||
        name.trim() !== name ||
        name.includes('*') ||
        /^[+-]/.test(name) ||
        reservedToolNames.has(name) ||
        isMcpToolName(name)
    ) ||
    new Set(names).size !== names.length
  ) {
    throw new Error('工具名必须唯一且不能包含保留名、SDK 选择器通配符或修饰前缀');
  }
  const hasTools = names.length > 0;
  const mcp = access.mcpExtensions;
  // 延迟加载的工具由 pi 原生 tool_search 按需声明；加载后的调用仍经过下方授权。
  const deferred = new Set(access.tools.filter(tool => tool.exposure === 'deferred').map(tool => tool.name));
  const useToolSearch = deferred.size > 0 || mcp !== undefined;
  const useCodemode = hasTools || mcp !== undefined;
  if (useToolSearch) names.push(toolSearchName);
  if (useCodemode) names.push(codemodeToolName);
  const registered = new Set(names);
  // 名单带 mcp__ 前缀时 pi 才允许声明 direct 暴露的 MCP 工具。
  if (mcp) names.push(...sessionMcpToolNames);
  const guard: ExtensionFactory = pi => {
    if (useCodemode) createHostCodemodeExtension(access.codemode)(pi);
    if (useToolSearch) createToolSearchExtension()(pi);
    // MCP 工具注册时 pi 会按名单重新激活全部可声明工具，每次请求前都让宿主校正一次。
    if (mcp) pi.on('before_agent_start', (_event, ctx) => access.onToolsLoaded?.(ctx.sessionManager.getSessionId()));
    pi.on('tool_result', (event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      access.onToolActivity?.(sessionId, event);
      if (mcp || event.toolName === toolSearchName) access.onToolsLoaded?.(sessionId);
    });
    pi.on('tool_call', async (event, ctx) => {
      const sessionId = ctx.sessionManager.getSessionId();
      access.onToolActivity?.(sessionId, event);
      if (registered.has(event.toolName)) return;
      if (!mcp || !isMcpToolName(event.toolName)) return { block: true, reason: '工具未在应用宿主中授权注册' };
      const decision = await authorizeCall(
        access.authorize,
        {
          sessionId,
          cwd: ctx.cwd,
          toolCallId: event.toolCallId,
          toolName: event.toolName,
          input: structuredClone(event.input)
        },
        ctx.signal
      );
      if (decision?.allow !== true) return { block: true, reason: decision?.reason || '工具调用未获授权' };
    });
  };
  return {
    names,
    deferred,
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
    // 激活原生内置工具不等于应用授予了执行权；未显式注册的工具一律阻断。守卫排在 MCP 扩展之前，授权先于连接等待。
    extensions: [guard, ...(mcp ?? [])]
  };
}
