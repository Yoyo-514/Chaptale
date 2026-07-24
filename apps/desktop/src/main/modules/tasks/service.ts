import type { PersonaDefinition } from '@chaptale/shared';

import type { TaskRunner, TaskRunResult } from '../../integrations/pi/agent/task-runner';
import { ContextFileService } from '../context/service';
import type { PersonaRegistry } from '../personas/registry';
import type { SettingsService } from '../settings/service';

export type TaskServiceOptions = {
  settingsService: SettingsService;
  personaRegistry: PersonaRegistry;
  taskRunner: TaskRunner;
  contextFileService?: Pick<ContextFileService, 'resolve'>;
};

export type TaskStartRequest = {
  /** renderer 预生成的请求标识：运行期间取消的路由键。 */
  requestId: string;
  personaId: string;
  brief: string;
  text: string;
  contextFilePaths?: string[];
};

/**
 * 任务执行服务：管理活跃任务的生命周期（启动/取消）。
 *
 * 取消以 requestId 路由：runId 由 TaskRunner 生成并用于落盘，
 * 但 await 式 IPC 在运行期间无法把它交给 renderer，故取消键由调用方预生成。
 */
export class TaskService {
  private readonly activeRuns = new Map<string, AbortController>();
  private readonly contextFileService: Pick<ContextFileService, 'resolve'>;

  constructor(private readonly options: TaskServiceOptions) {
    this.contextFileService = options.contextFileService ?? new ContextFileService();
  }

  async start(request: TaskStartRequest): Promise<TaskRunResult> {
    const cwd = await this.options.settingsService.getCurrentCwd();
    const loadResult = await this.options.personaRegistry.load(cwd);
    const persona = loadResult.personas.find((p: PersonaDefinition) => p.id === request.personaId);

    if (!persona) {
      throw new Error(`persona 不存在：${request.personaId}`);
    }

    if (!request.text.trim() && !request.contextFilePaths?.length) {
      throw new Error('没有可审查的文本：请输入内容或附加文件');
    }

    if (this.activeRuns.has(request.requestId)) {
      throw new Error(`重复的任务请求：${request.requestId}`);
    }

    // 附件文本复用对话流的上下文解析（同一套大小/类型约束），信封原样传入提示词。
    const contextPrompt = request.contextFilePaths?.length
      ? (await this.contextFileService.resolve(request.contextFilePaths)).promptPrefix
      : undefined;

    const controller = new AbortController();
    this.activeRuns.set(request.requestId, controller);

    try {
      return await this.options.taskRunner.run({
        persona,
        cwd,
        brief: request.brief,
        text: request.text,
        contextPrompt,
        trigger: 'ui-action',
        signal: controller.signal
      });
    } finally {
      this.activeRuns.delete(request.requestId);
    }
  }

  cancel(requestId: string): void {
    this.activeRuns.get(requestId)?.abort();
  }
}
