import path from 'node:path';

import { ImageAttachmentService } from '../core/attachments/service';
import { ContextFileAuthorizationRegistry } from '../core/context/authorization';
import { ContextFileService } from '../core/context/service';
import { parseFrontmatter } from '../core/frontmatter/parse';
import { ModelService } from '../core/models/service';
import { SettingsService } from '../core/settings/service';
import { createDefaultToolCatalog } from '../core/tool-protocol/catalog';
import { createChatRuntimeBundle, createBrokerPermissionGate } from '../features/agent/chat-bundle';
import { AgentService } from '../features/agent/service';
import { buildTaskSessionTools } from '../features/agent/tool-assembly';
import { SlashCommandService } from '../features/commands/service';
import { createMemoryInjector } from '../features/memory/injector';
import { MemoryPendingStore } from '../features/memory/pending-store';
import { PermissionBroker } from '../features/permissions/broker';
import { PermissionRuleStore } from '../features/permissions/rule-store';
import { createDefaultPersonaRegistry } from '../features/personas/persona-registry-factory';
import { PromptFileService } from '../features/prompts/file-service';
import { ReviewOutputStore } from '../features/reviews/store';
import { AgentRunStore } from '../features/runs/store';
import { AttachedFileSearchService } from '../features/search/attached-file-search-service';
import { IndexService } from '../features/search/index-service';
import { LiteralSearchProvider } from '../features/search/literal-search-provider';
import { MemorySearchService } from '../features/search/memory-search-service';
import { WorkspaceIndexSourceResolver } from '../features/search/source-resolver';
import { CoreSessionRepository } from '../features/sessions/core-repository';
import { materializeBuiltinSkills } from '../features/skills/builtin-materializer';
import { SkillsProvider } from '../features/skills/skills-provider';
import { SubagentPool } from '../features/subagent/pool';
import type { TaskOutputStorePort } from '../features/tasks/output-port';
import { TaskService } from '../features/tasks/service';
import { TaskRunner } from '../features/tasks/task-runner';
import { TaskSessionFactory } from '../features/tasks/task-session-factory';
import { TodoStore } from '../features/todo/store';
import { WebToolsSettingsAdapter } from '../features/web-tools/adapter';
import { WebToolsSettingsStore } from '../features/web-tools/settings';
import { ElectronContextFilePlatform } from '../infra/electron/context-file-platform';
import { createElectronThumbnail } from '../infra/electron/thumbnail';
import { OfficeDocumentParser } from '../integrations/officeparser/parser';
import { TaskOutputRouter } from './task-output-router';

export type AppContext = {
  settingsService: SettingsService;
  sessionRepository: CoreSessionRepository;
  modelService: ModelService;
  agentRuntime: AgentService;
  contextFileService: ContextFileService;
  promptFileService: PromptFileService;
  commandService: SlashCommandService;
  taskService: TaskService;
  runStore: AgentRunStore;
  taskOutputStore: TaskOutputStorePort;
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
  const settingsService = new SettingsService(new WebToolsSettingsAdapter());
  const webToolsSettingsStore = new WebToolsSettingsStore({ configPath: settingsService.webToolsConfigPath });

  // 内置 skills 先于任何会话创建物化到磁盘；失败只影响内置 skills 可用性，不阻塞启动。
  try {
    materializeBuiltinSkills(settingsService.builtinSkillsDir);
  } catch (error) {
    console.error('内置 skills 物化失败:', error);
  }

  const contextFileAuthorization = new ContextFileAuthorizationRegistry();
  const contextFileService = new ContextFileService(
    new ElectronContextFilePlatform(),
    new OfficeDocumentParser(),
    new AttachedFileSearchService(),
    contextFileAuthorization
  );
  // createElectronThumbnail 失败时抛错，保留 attachments 层“跳过此图”分支。
  const imageAttachmentService = new ImageAttachmentService((data, mimeType) => {
    const thumbnail = createElectronThumbnail(data, mimeType);

    if (!thumbnail) {
      throw new Error('无法生成缩略图');
    }

    return thumbnail;
  }, contextFileAuthorization);
  const sessionRepository = new CoreSessionRepository({
    rootDir: settingsService.agentDir,
    cwd: () => settingsService.getCurrentCwd(),
    sessionDir: () => settingsService.getCurrentSessionDir(),
    sessionsRootDir: settingsService.sessionsRootDir,
    getStorageContext: () => settingsService.getStorageContext(),
    imageAttachmentService
  });
  const modelService = new ModelService({ modelsPath: settingsService.modelsPath });
  const promptFileService = new PromptFileService(settingsService.agentDir);
  const personaRegistry = createDefaultPersonaRegistry(settingsService);
  const toolCatalog = createDefaultToolCatalog();
  const skillsProvider = new SkillsProvider(settingsService);
  const todoStore = new TodoStore(settingsService.todosDir);
  const permissionBroker = new PermissionBroker();
  const permissionRuleStore = new PermissionRuleStore({ globalDir: settingsService.rootDir });
  const commandService = new SlashCommandService(settingsService, skillsProvider);
  const subagentPool = new SubagentPool();
  const memoryPendingStore = new MemoryPendingStore({ parseFrontmatter });
  const indexSourceResolver = new WorkspaceIndexSourceResolver();
  const indexService = new IndexService({
    resolver: indexSourceResolver,
    parseFrontmatter,
    cacheRoot: path.join(settingsService.rootDir, 'cache')
  });
  const memorySearchService = new MemorySearchService({
    indexSearch: (cwd, query, options) => indexService.search(cwd, query, options),
    literalSearch: new LiteralSearchProvider({ resolver: indexSourceResolver, parseFrontmatter }),
    sourceResolver: indexSourceResolver
  });
  // runs/reviews 归属工作区：审查历史是创作产物，随作品同步。
  const runStore = new AgentRunStore({ resolveCwd: () => settingsService.getCurrentCwd() });
  const reviewStore = new ReviewOutputStore({ resolveCwd: () => settingsService.getCurrentCwd() });
  const taskOutputStore = new TaskOutputRouter({ runStore, reviewStore });

  // task 链路：TaskSessionFactory/TaskRunner 承接结构化任务会话。
  const taskSessionFactory = new TaskSessionFactory({
    settingsService,
    modelService,
    buildTaskTools: (spec, cwd, onMemoryRead) => buildTaskSessionTools({ spec, cwd, memorySearchService, onMemoryRead })
  });
  const taskRunner = new TaskRunner(taskSessionFactory, runStore, taskOutputStore, toolCatalog);
  const taskService = new TaskService({ settingsService, personaRegistry, taskRunner, contextFileService });

  // chat 链路（自有）：P2-c 产物的装配入口；systemPrompt 经 persona 三层覆盖解析。
  const runtimeBundle = createChatRuntimeBundle({
    personaRegistry,
    taskRunner,
    skillsProvider,
    toolCatalog,
    todoStore,
    subagentPool,
    memoryPendingStore,
    memorySearchService,
    webToolsSettingsStore,
    modelService
  });
  const agentRuntime = new AgentService({
    sessionRepository,
    modelService,
    runtimeBundle,
    gate: createBrokerPermissionGate(permissionBroker),
    contextFileService,
    imageAttachmentService,
    memoryInjector: createMemoryInjector(settingsService.agentDir),
    compactPrompt: '请把以下对话压缩为保留关键事实与决策的摘要，供后续创作参考。'
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
    taskOutputStore,
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
