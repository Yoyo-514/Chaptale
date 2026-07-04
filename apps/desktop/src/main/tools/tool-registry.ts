import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

import type { ChaptaleToolDefinition } from './core/chaptale-tool';
import { toPiToolDefinition } from './pi/pi-tool-adapter';
import { websearchTool } from './websearch/websearch.tool';

/**
 * Custom Agent 白名单工具。
 *
 * 后续新增 Chaptale 专有工具时，在这里注册即可。
 */
export const chaptaleTools: ChaptaleToolDefinition[] = [websearchTool];

export function getEnabledToolNames() {
  return chaptaleTools.map(tool => tool.name);
}

export function getPiCustomTools(): ToolDefinition[] {
  return chaptaleTools.map(tool => toPiToolDefinition(tool));
}
