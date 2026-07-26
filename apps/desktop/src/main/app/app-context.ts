import path from 'node:path';

import { ChatSessionFactory } from '../integrations/pi/agent/chat-session-factory';
import { createCompactExt } from '../integrations/pi/agent/compact-extension';
import { piParseFrontmatter } from '../integrations/pi/agent/frontmatter';
import { InputAssembler } from '../integrations/pi/agent/input-assembler';
import { createDefaultPersonaRegistry } from '../integrations/pi/agent/persona-registry-factory';
import { PiAgentService } from '../integrations/pi/agent/service';
import { TaskRunner } from '../integrations/pi/agent/task-runner';
import { TaskSessionFactory } from '../integrations/pi/agent/task-session-factory';
import { PiModelService } from '../integrations/pi/models/service';
import { PiSessionRepository } from '../integrations/pi/sessions/repository';
import { SkillsProvider } from '../integrations/pi/skills/provider';
import { PiWebAccessAdapter } from '../integrations/pi/web-access/config-mapper';
import { ImageAttachmentService } from '../modules/attachments/service';
import { SlashCommandService } from '../modules/commands/service';
import { ContextFileService } from '../modules/context/service';
import { CompactCoord } from '../modules/memory/compact-coord';
import { CompactionSummaryStore } from '../modules/memory/compaction-summary-store';
import { createMemoryInjector } from '../modules/memory/injector';
import { MemoryPendingStore } from '../modules/memory/pending-store';
import { MemoryService } from '../modules/memory/service';
import { PermissionBroker } from '../modules/permissions/broker';
import { PermissionRuleStore } from '../modules/permissions/rule-store';
import { PromptFileService } from '../modules/prompts/file-service';
import { AgentRunStore } from '../modules/runs/store';
import { IndexService } from '../modules/search/index-service';
import { LiteralSearchProvider } from '../modules/search/literal-search-provider';
import { MemorySearchService } from '../modules/search/memory-search-service';
import { WorkspaceIndexSourceResolver } from '../modules/search/source-resolver';
import { SettingsService } from '../modules/settings/service';
import { materializeBuiltinSkills } from '../modules/skills/builtin-materializer';
import { SubagentPool } from '../modules/subagent/pool';
import { TaskService } from '../modules/tasks/service';
import { TodoStore } from '../modules/todo/store';
import { createDefaultToolCatalog } from '../modules/tools/catalog';
import { buildChatSessionTools, buildTaskSessionTools } from '../modules/tools/tool-registry';

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
  /** 权限设置页使用 UI 当前 workspace；工具调用授权仍由会话 ctx 绑定。 */
  getPermissionSettingsCwd: () => Promise<string | null>;
  /** Pending 面板只按 UI 当前 workspace 拉取，避免复用会话工具闭包 cwd。 */
  getMemoryPendingCwd: () => Promise<string>;
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
  const personaRegistry = createDefaultPersonaRegistry(settingsService);
  const toolCatalog = createDefaultToolCatalog();
  const skillsProvider = new SkillsProvider(settingsService);
  const todoStore = new TodoStore(settingsService.todosDir);
  const permissionBroker = new PermissionBroker();
  const permissionRuleStore = new PermissionRuleStore({ globalDir: settingsService.rootDir });
  const commandService = new SlashCommandService(settingsService, skillsProvider);
  const subagentPool = new SubagentPool();
  const memoryPendingStore = new MemoryPendingStore({ parseFrontmatter: piParseFrontmatter });
  const indexSourceResolver = new WorkspaceIndexSourceResolver();
  const indexService = new IndexService({
    resolver: indexSourceResolver,
    parseFrontmatter: piParseFrontmatter,
    cacheRoot: path.join(settingsService.rootDir, 'cache')
  });
  const memorySearchService = new MemorySearchService({
    indexSearch: (cwd, query, options) => indexService.search(cwd, query, options),
    literalSearch: new LiteralSearchProvider({ resolver: indexSourceResolver, parseFrontmatter: piParseFrontmatter }),
    sourceResolver: indexSourceResolver
  });
  // runs 归属工作区（<workspace>/.chaptale/runs）：审查历史是创作产物，随作品同步。
  const runStore = new AgentRunStore({ resolveCwd: () => settingsService.getCurrentCwd() });
  const taskSessionFactory = new TaskSessionFactory({
    settingsService,
    modelService,
    permissionBroker,
    permissionRuleStore,
    buildTaskTools: (spec, cwd) => buildTaskSessionTools({ spec, cwd, memorySearchService })
  });
  const taskRunner = new TaskRunner(taskSessionFactory, runStore, toolCatalog);
  const taskService = new TaskService({ settingsService, personaRegistry, taskRunner });
  const compactCoord = new CompactCoord({
    personas: personaRegistry,
    tasks: taskRunner,
    memory: new MemoryService({ chaptaleRootDir: settingsService.rootDir }),
    summaries: new CompactionSummaryStore()
  });
  const chatSessionFactory = new ChatSessionFactory({
    settingsService,
    modelService,
    skillsProvider,
    todoStore,
    permissionBroker,
    permissionRuleStore,
    personaRegistry,
    toolCatalog,
    // 工具注册统一由 modules/tools 管理；此处只注入运行时依赖。
    buildChatTools: context =>
      buildChatSessionTools({
        ...context,
        todoStore,
        getSessionId: () => context.sessionId,
        subagentPool,
        taskRunner,
        personaRegistry,
        memoryPendingStore,
        memorySearchService
      }),
    // manual/threshold/overflow 共用此扩展；检查点失败时显式 cancel，禁止回退 coding 摘要。
    buildCompactExt: (sessionId, cwd) =>
      createCompactExt({
        sessionId,
        cwd,
        coord: compactCoord,
        onError: (error, reason) => console.error(`创作会话压缩失败（${reason}）:`, error)
      })
  });
  const agentRuntime = new PiAgentService({
    chatFactory: chatSessionFactory,
    modelService,
    memoryInjector: createMemoryInjector(settingsService.rootDir),
    permissionBroker,
    inputAssembler: new InputAssembler({
      contextFileService: new ContextFileService(),
      imageAttachmentService: new ImageAttachmentService()
    })
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
    todoStore,
    subagentPool,
    memoryPendingStore,
    indexService,
    permissionBroker,
    permissionRuleStore,
    getPermissionSettingsCwd: () => settingsService.getCurrentCwd(),
    getMemoryPendingCwd: () => settingsService.getCurrentCwd()
  };
}
