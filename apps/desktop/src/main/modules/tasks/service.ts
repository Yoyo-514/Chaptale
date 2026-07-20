import type { PersonaDefinition } from '@chaptale/shared';
import { randomUUID } from 'node:crypto';

import { ContextFileService } from '../context/service';
import type { PersonaRegistry } from '../personas/registry';
import type { TaskRunner } from '../../integrations/pi/agent/task-runner';
import type { SettingsService } from '../settings/service';

export type TaskServiceOptions = {
  settingsService: SettingsService;
  personaRegistry: PersonaRegistry;
  taskRunner: TaskRunner;
  contextFileService?: Pick<ContextFileService, 'resolve'>;
};

export type TaskRunHandle = {
  runId: string;
  /** 完成时 resolve 的 promise，供 IPC handler await。 */
  promise: Promise<TaskServiceResult>;
};

export type TaskServiceResult =
  | { status: 'success'; output: unknown; outputRef: string }
  | { status: 'failed'; errors: string[]; outputRef: string }
  | { status: 'cancelled' };

/**
 * 任务执行服务：管理活跃任务的生命周期（启动/取消/查询）。
 *
 * 每个 run 拥有独立 AbortController，IPC 取消请求通过 runId 路由到正确的 controller。
 */
export class TaskService {
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly contextFileService: Pick<ContextFileService, 'resolve'>;

  constructor(private readonly options: TaskServiceOptions) {
    this.contextFileService = options.contextFileService ?? new ContextFileService();
  }

  async start(personaId: string, brief: string, text: string, contextFilePaths?: string[]): Promise<TaskRunHandle> {
    const runId = randomUUID();
    const cwd = await this.options.settingsService.getCurrentCwd();
    const loadResult = await this.options.personaRegistry.load(cwd);
    const persona = loadResult.personas.find((p: PersonaDefinition) => p.id === personaId);

    if (!persona) {
      throw new Error(`persona 不存在：${personaId}`);
    }

    if (!text.trim() && !contextFilePaths?.length) {
      throw new Error('没有可审查的文本：请输入内容或附加文件');
    }

    // 附件文本复用对话流的上下文解析（同一套大小/类型约束），信封原样传入提示词。
    const contextPrompt = contextFilePaths?.length
      ? (await this.contextFileService.resolve(contextFilePaths)).promptPrefix
      : undefined;

    const controller = new AbortController();
    this.activeRuns.set(runId, controller);

    const promise = this.options.taskRunner
      .run({ persona, brief, text, contextPrompt, trigger: 'ui-action', signal: controller.signal })
      .then(result => {
        if (result.status === 'success') {
          return { status: 'success' as const, output: result.output, outputRef: result.outputRef };
        }

        if (result.status === 'failed') {
          return { status: 'failed' as const, errors: result.errors, outputRef: result.outputRef };
        }

        return { status: 'cancelled' as const };
      })
      .finally(() => this.activeRuns.delete(runId));

    return { runId, promise };
  }

  cancel(runId: string): void {
    this.activeRuns.get(runId)?.abort();
  }
}
