import { Type } from 'typebox';
import { Compile } from 'typebox/compile';

/** 会话过滤参数：查询活跃子任务。 */
export const SubagentListActiveArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const SubagentListActiveArgsValidator = Compile(SubagentListActiveArgsSchema);

/** 取消参数：requestId。 */
export const SubagentCancelArgsSchema = Type.Tuple([Type.String({ minLength: 1 })]);
export const SubagentCancelArgsValidator = Compile(SubagentCancelArgsSchema);
