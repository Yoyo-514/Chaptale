/**
 * 来自 pi SDK 的内置工具。
 *
 * read/grep/find/ls/write/edit 是 Chaptale 后续工作区与文件处理能力的基础；
 * bash 暂不启用，避免在非代码软件里默认暴露任意命令执行能力。
 */
export const piBuiltinToolNames = ['read', 'grep', 'find', 'ls', 'write', 'edit'] as const;

/**
 * 来自显式加载的 pi package extension 的工具（pi-web-access）。
 *
 * AgentSession 会从 extension runtime 注册表中按名称白名单启用它们。
 */
export const piPackageToolNames = ['web_search', 'fetch_content', 'get_search_content'] as const;

export function getEnabledToolNames(): string[] {
  return [...piBuiltinToolNames, ...piPackageToolNames];
}
