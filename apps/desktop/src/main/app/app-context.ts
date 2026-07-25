import path from 'node:path';

import { createCompactExt } from '../integrations/pi/agent/compact-extension';
import { PiAgentService } from '../integrations/pi/agent/service';
import { createDefaultPersonaRegistry, piParseFrontmatter } from '../integrations/pi/agent/session-factory';
import { TaskRunner } from '../integrations/pi/agent/task-runner';
import { PiModelService } from '../integrations/pi/models/service';
import { PiSessionRepository } from '../integrations/pi/sessions/repository';
import { PiWebAccessAdapter } from '../integrations/pi/web-access/config-mapper';
import { SlashCommandService } from '../modules/commands/service';
import { CompactCoord } from '../modules/memory/compact-coord';
import { CompactionSummaryStore } from '../modules/memory/compaction-summary-store';
import { MemoryPendingStore } from '../modules/memory/pending-store';
import { MemoryService } from '../modules/memory/service';
import { createMemoryProposeTool, createMemorySaveTool } from '../modules/memory/tools';
import type { PermissionBroker } from '../modules/permissions/broker';
import type { PermissionRuleStore } from '../modules/permissions/rule-store';
import { PromptFileService } from '../modules/prompts/file-service';
import { AgentRunStore } from '../modules/runs/store';
import { IndexService } from '../modules/search/index-service';
import { WorkspaceIndexSourceResolver } from '../modules/search/source-resolver';
import { SettingsService } from '../modules/settings/service';
import { materializeBuiltinSkills } from '../modules/skills/builtin-materializer';
import { createDelegateTool } from '../modules/subagent/delegate-tool';
import { SubagentPool } from '../modules/subagent/pool';
import { TaskService } from '../modules/tasks/service';
import type { TodoStore } from '../modules/todo/store';

export type AppContext = {
  settingsService: SettingsService;
  sessionRepository: PiSessionRepository;
  modelService: PiModelService;
  agentRuntime: PiAgentService;
  promptFileService: PromptFileService;
  commandService: SlashCommandService;
  taskService: TaskService;
  runStore: AgentRunStore;
  todoStore: TodoStore;
  subagentPool: SubagentPool;
  memoryPendingStore: MemoryPendingStore;
  indexService: IndexService;
  permissionBroker: PermissionBroker;
  permissionRuleStore: PermissionRuleStore;
};

export function createAppContext(): AppContext {
  const webAccessAdapter = new PiWebAccessAdapter();
  const settingsService = new SettingsService(webAccessAdapter);

  // 内置 skills 先于任何会话创建物化到磁盘（pi 目录扫描与模型 read 都需要真实文件）；
  // 失败只影响内置 skills 可用性，不阻塞应用启动。
  try {
    materializeBuiltinSkills(settingsService.builtinSkillsDir);
  } catch (error) {
    console.error('内置 skills 物化失败:', error);
  }

  const sessionRepository = new PiSessionRepository({
    rootDir: settingsService.agentDir,
    cwd: () => settingsService.getCurrentCwd(),
    sessionDir: () => settingsService.getCurrentSessionDir(),
    sessionsRootDir: settingsService.sessionsRootDir,
    getStorageContext: () => settingsService.getStorageContext()
  });
  const modelService = new PiModelService(settingsService);
  const promptFileService = new PromptFileService(settingsService.agentDir);
  const agentRuntime = new PiAgentService(settingsService, modelService);
  const commandService = new SlashCommandService(settingsService, agentRuntime.skillsProvider);
  const personaRegistry = createDefaultPersonaRegistry(settingsService);
  const permissionRuleStore = agentRuntime.permissionRuleStore;
  const permissionBroker = agentRuntime.permissionBroker;
  // runs 归属工作区（<workspace>/.chaptale/runs）：审查历史是创作产物，随作品同步。
  const runStore = new AgentRunStore({ resolveCwd: () => settingsService.getCurrentCwd() });
  // 复用 agent runtime 的会话工厂：task 会话与 chat 会话共享模型/权限接线，避免双实例漂移。
  const taskRunner = new TaskRunner(agentRuntime.sessionFactory, runStore);
  const taskService = new TaskService({ settingsService, personaRegistry, taskRunner });
  const compactCoord = new CompactCoord({
    personas: personaRegistry,
    tasks: taskRunner,
    memory: new MemoryService({ chaptaleRootDir: settingsService.rootDir }),
    summaries: new CompactionSummaryStore()
  });
  // manual/threshold/overflow 共用此扩展；检查点失败时显式 cancel，禁止回退 coding 摘要。
  agentRuntime.sessionFactory.setCompactExt((sessionId, cwd) =>
    createCompactExt({
      sessionId,
      cwd,
      coord: compactCoord,
      onError: (error, reason) => console.error(`创作会话压缩失败（${reason}）:`, error)
    })
  );
  const subagentPool = new SubagentPool();
  const memoryPendingStore = new MemoryPendingStore({
    resolveCwd: () => settingsService.getCurrentCwd(),
    parseFrontmatter: piParseFrontmatter
  });
  const indexService = new IndexService({
    resolver: new WorkspaceIndexSourceResolver(),
    parseFrontmatter: piParseFrontmatter,
    cacheRoot: path.join(settingsService.rootDir, 'cache')
  });

  // delegate 工具依赖 taskRunner，而 taskRunner 又依赖会话工厂；
  // 通过工厂的额外工具注册点 late-bind，避免构造期循环。
  agentRuntime.sessionFactory.setExtraChatTools(async sessionId => {
    const resolveCwd = () => settingsService.getCurrentCwd();
    // persona.memory 权限矩阵在工具组装时执行：缺省（未声明）按协议默认全开，
    // 显式声明时按矩阵收窄——write 含 notes 才挂笔记工具，propose 非空才挂提议工具。
    const memoryMatrix = (await personaRegistry.get(await resolveCwd(), 'companion'))?.memory;
    const canSaveNotes = !memoryMatrix || (memoryMatrix.write ?? []).includes('notes');
    const canPropose = !memoryMatrix || (memoryMatrix.propose ?? []).length > 0;
    const memoryToolContext = { resolveCwd, getSessionId: () => sessionId };

    return [
      await createDelegateTool({
        pool: subagentPool,
        taskRunner,
        personaRegistry,
        resolveCwd,
        sessionId
      }),
      ...(canSaveNotes ? [createMemorySaveTool(memoryToolContext)] : []),
      ...(canPropose ? [createMemoryProposeTool({ ...memoryToolContext, pendingStore: memoryPendingStore })] : [])
    ];
  });

  return {
    settingsService,
    sessionRepository,
    modelService,
    agentRuntime,
    promptFileService,
    commandService,
    taskService,
    runStore,
    todoStore: agentRuntime.todoStore,
    subagentPool,
    memoryPendingStore,
    indexService,
    permissionBroker,
    permissionRuleStore
  };
}
