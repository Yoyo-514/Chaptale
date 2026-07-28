import type { PersonaDefinition } from '@chaptale/shared';

import type { TaskPersonaSpec } from '../personas/task-spec';
import type { AgentRunTrigger } from '../runs/record';

export type TaskRunRequest = {
  persona: PersonaDefinition;
  /** 启动时绑定的工作区；task session、输出和 AgentRun 必须使用同一值。 */
  cwd: string;
  /** 任务简报：要做什么。 */
  brief: string;
  /** 待处理文本（粘贴或上传的正文）。 */
  text: string;
  /** 附件解析出的上下文信封（attached_context_files），原样嵌入提示词。 */
  contextPrompt?: string;
  /** 本次输入涉及的文件引用，仅用于 AgentRun 摘要。 */
  files?: string[];
  /** Context Pack 引用；无 pack 的粘贴/附件任务保持为空。 */
  packId?: string;
  /** 调用方在组装输入时实际读取的 memory 引用。 */
  memoryRefs?: string[];
  trigger: AgentRunTrigger;
  parentSessionId?: string;
  /** 完整首轮 prompt 的硬预算；缺省不裁剪。 */
  maxPromptTokens?: number;
  signal?: AbortSignal;
};

export type TaskRunUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type TaskRunResult =
  | { status: 'success'; runId: string; output: unknown; outputRef: string; usage: TaskRunUsage }
  | { status: 'failed'; runId: string; errors: string[]; outputRef: string; usage: TaskRunUsage }
  | { status: 'cancelled'; runId: string; usage?: TaskRunUsage };

/** task 型 persona 的执行端口；具体运行时由 integrations 层实现。 */
export type TaskRunnerPort = {
  run(request: TaskRunRequest): Promise<TaskRunResult>;
};

/** 一次性 task 会话的创建端口；会话类型由实现方决定，应用层不感知运行时。 */
export type TaskSessionFactoryPort<TSession> = {
  createTaskSession(
    spec: TaskPersonaSpec,
    cwdOverride?: string,
    onMemoryRead?: (refs: readonly string[]) => void
  ): Promise<TSession>;
};
