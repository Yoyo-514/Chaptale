import type { ToolDefinition } from '@earendil-works/pi-coding-agent';

import type { CreationApplication } from '@chaptale/creation/application';

import type { EditMode } from '../../protocol.ts';
import { entryTools } from './entries.ts';
import { recordTools } from './records.ts';
import { relationTools } from './relations.ts';
import { workToolKit } from './shared.ts';

export const workWriteToolNames = new Set([
  'work_edit',
  'work_write',
  'work_mkdir',
  'work_mv',
  'work_rm',
  'work_record_write',
  'work_relation_write'
]);
export const workToolNames = new Set([
  'work_ls',
  'work_read',
  'work_find',
  'work_grep',
  'work_search',
  'work_record_ls',
  'work_relation_ls',
  ...workWriteToolNames
]);

/** 事件与关系工具默认不声明，由 tool_search 按名称加载；宿主在系统提示词末尾说明。 */
export const deferredWorkToolsPrompt =
  '作品事件工具 work_record_ls、work_record_write 与关系工具 work_relation_ls、work_relation_write 默认未加载；需要时先用 tool_search 以工具名查询加载。';

/** 作品工具只转换公共参数；身份、内容与候选规则由宿主和 creation 持有。 */
export function createWorkTools(
  application: CreationApplication,
  mode: (sessionId: string) => EditMode,
  onPendingWrite: (sessionId: string) => void
): ToolDefinition[] {
  const kit = workToolKit(application, mode, onPendingWrite);
  const deferred = [...recordTools(kit), ...relationTools(kit)];
  for (const tool of deferred) tool.exposure = 'deferred';
  return [...entryTools(kit), ...deferred];
}
