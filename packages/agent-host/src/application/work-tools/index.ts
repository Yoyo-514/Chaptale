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
  '作品事件工具 work_record_ls、work_record_write 与关系工具 work_relation_ls、work_relation_write 默认未直接声明：单次调用前先用 tool_search 按工具名查询加载；在 codemode 脚本中可直接调用 tools.work_record_* 与 tools.work_relation_*，无需先调 tool_search。' +
  '跨章核对、批量检索资料，或串联新建资料与写入事件和关系时，优先用 codemode 一次完成；单步读写直接调用对应工具。' +
  '写完或改写章节后，本章新发生的事件和关系变化用这些工具一并记下，出处取读取本章所得的修订，并在回复中简要说明一并记录的内容；对作者交流使用章节与资料标题，不展示内部 ID 或工具字段名。' +
  '审阅模式下写入的修改先成为本会话待接受修改，可以接着在其基础上继续写；完成本次请求后停下，由作者发消息推进。作者保存过的候选在重新读取后按最新版本补改，迟到的旧版本写入会被拒绝。';

/** 作品工具只转换公共参数；身份、内容与候选规则由宿主和 creation 持有。 */
export function createWorkTools(
  application: CreationApplication,
  mode: (sessionId: string) => EditMode
): ToolDefinition[] {
  const kit = workToolKit(application, mode);
  const deferred = [...recordTools(kit), ...relationTools(kit)];
  for (const tool of deferred) tool.exposure = 'deferred';
  return [...entryTools(kit), ...deferred];
}
