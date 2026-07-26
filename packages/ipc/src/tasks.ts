import type { Static } from 'typebox';

import type { AgentRunsListResultSchema, TaskListRunsPayloadSchema, TaskRunPayloadSchema } from './schemas/tasks';

/** tasks.run 的请求 payload。 */
export type TaskRunPayload = Static<typeof TaskRunPayloadSchema>;

/** tasks.run 完成后主进程推送给 renderer 的结果事件。 */
export type TaskRunCompleteEvent =
  | { runId: string; status: 'success'; output: unknown; outputRef: string }
  | { runId: string; status: 'failed'; errors: string[]; outputRef: string }
  | { runId: string; status: 'cancelled' };

/** agentRuns.list 的请求 payload。 */
export type AgentRunsListPayload = Static<typeof TaskListRunsPayloadSchema>;

/** tasks.listRuns 的返回结果。 */
export type AgentRunsListResult = Static<typeof AgentRunsListResultSchema>;
