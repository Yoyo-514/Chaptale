import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

import type { ChaptaleToolDefinition } from './core/chaptale-tool';
import { toPiToolDefinition } from './pi/pi-tool-adapter';

/**
 * Chaptale 自有工具。
 *
 * 当前联网能力改由显式加载的 pi-web-access package 提供；
 * 后续新增 Chaptale 专有工具时，在这里注册即可。
 */
export const chaptaleTools: ChaptaleToolDefinition[] = [];

/**
 * 来自显式加载的 pi package extension 的工具。
 *
 * 注意：这些工具不是 Chaptale 自有工具，因此不放进 customTools；
 * AgentSession 会从 extension runtime 注册表中按名称白名单启用它们。
 */
export const piPackageToolNames = ['web_search', 'fetch_content', 'get_search_content'] as const;

export function getEnabledToolNames() {
  return [...piPackageToolNames, ...chaptaleTools.map(tool => tool.name)];
}

export function getPiCustomTools(): ToolDefinition[] {
  return chaptaleTools.map(tool => toPiToolDefinition(tool));
}
