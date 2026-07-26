import path from 'node:path';

import { ImageAttachmentService } from '../core/attachments/service';
import { ContextFileService } from '../core/context/service';
import { SettingsService } from '../core/settings/service';
import { createDefaultToolCatalog } from '../core/tool-protocol/catalog';
import { SlashCommandService } from '../features/commands/service';
import { CompactCoord } from '../features/memory/compact-coord';
import { CompactionSummaryStore } from '../features/memory/compaction-summary-store';
import { createMemoryInjector } from '../features/memory/injector';
import { MemoryPendingStore } from '../features/memory/pending-store';
import { MemoryService } from '../features/memory/service';
import { PermissionBroker } from '../features/permissions/broker';
import { PermissionRuleStore } from '../features/permissions/rule-store';
import { PromptFileService } from '../features/prompts/file-service';
import { AgentRunStore } from '../features/runs/store';
import { IndexService } from '../features/search/index-service';
import { LiteralSearchProvider } from '../features/search/literal-search-provider';
import { MemorySearchService } from '../features/search/memory-search-service';
import { WorkspaceIndexSourceResolver } from '../features/search/source-resolver';
import { materializeBuiltinSkills } from '../features/skills/builtin-materializer';
import { SubagentPool } from '../features/subagent/pool';
import { TaskService } from '../features/tasks/service';
import { TodoStore } from '../features/todo/store';
import { ElectronContextFilePlatform } from '../infra/electron/context-file-platform';
import { createElectronThumbnail } from '../infra/electron/thumbnail';
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
import { buildChatSessionTools, buildTaskSessionTools } from './tool-assembly';

export type AppContext = {
  settingsService: SettingsService;
  sessionRepository: PiSessionRepository;
  modelService: PiModelService;
  agentRuntime: PiAgentService;
  contextFileService: ContextFileService;
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

  const contextFileService = new ContextFileService(new ElectronContextFilePlatform());
  // createElectronThumbnail 失败时抛错，保留 attachments 层“跳过此图”分支。
  const imageAttachmentService = new ImageAttachmentService((data, mimeType) => {
    const thumbnail = createElectronThumbnail(data, mimeType);

    if (!thumbnail) {
      throw new Error('无法生成缩略图');
    }

    return thumbnail;
  });
  const sessionRepository = new PiSessionRepository(
    {
      rootDir: settingsService.agentDir,
      cwd: () => settingsService.getCurrentCwd(),
      sessionDir: () => settingsService.getCurrentSessionDir(),
      sessionsRootDir: settingsService.sessionsRootDir,
      getStorageContext: () => settingsService.getStorageContext()
    },
    imageAttachmentService
  );
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
  const taskService = new TaskService({ settingsService, personaRegistry, taskRunner, contextFileService });
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
    // 工具注册统一由 features/tools 管理；此处只注入运行时依赖。
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
    inputAssembler: new InputAssembler({ contextFileService, imageAttachmentService })
  });

  return {
    settingsService,
    sessionRepository,
    modelService,
    agentRuntime,
    contextFileService,
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
