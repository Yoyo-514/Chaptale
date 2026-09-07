import path from 'node:path';

import { ImageAttachmentService } from '../core/attachments/service';
import { ContextFileAuthorizationRegistry } from '../core/context/authorization';
import { ContextFileService } from '../core/context/service';
import { parseFrontmatter } from '../core/frontmatter/parse';
import { ModelService } from '../core/models/service';
import { SettingsService } from '../core/settings/service';
import { createDefaultToolCatalog } from '../core/tool-protocol/catalog';
import { createChatRuntimeBundle } from '../features/agent/chat-bundle';
import { AgentService } from '../features/agent/service';
import { buildTaskSessionTools } from '../features/agent/tool-assembly';
import { SlashCommandService } from '../features/commands/service';
import { LibraryService } from '../features/library/service';
import { CompactCoord } from '../features/memory/compaction/coord';
import { CompactionSummaryStore } from '../features/memory/compaction/summary-store';
import { MemoryInjector } from '../features/memory/injector';
import { MemoryPendingStore } from '../features/memory/pending/store';
import { MemoryService } from '../features/memory/service';
import { PermissionBroker } from '../features/permissions/broker';
import { PermissionRuleStore } from '../features/permissions/rule-store';
import { createDefaultPersonaRegistry } from '../features/personas/persona-registry-factory';
import { PromptFileService } from '../features/prompts/file-service';
import { ReviewService } from '../features/reviews/service';
import { ReviewOutputStore } from '../features/reviews/store';
import { ReviewWorkflowStore } from '../features/reviews/workflow-store';
import { AgentRunStore } from '../features/runs/store';
import { AttachedFileSearchService } from '../features/search/attached-file-service';
import { WorkspaceIndexSourceResolver } from '../features/search/index/source-resolver';
import { WorkspaceIndexWorker } from '../features/search/index/worker-client';
import { MemorySearchService } from '../features/search/memory/service';
import { JsonlSessionRepository } from '../features/sessions/repository';
import { SettlementService } from '../features/settlement/service';
import { materializeBuiltinSkills } from '../features/skills/builtin-materializer';
import { SkillsProvider } from '../features/skills/provider';
import { SubagentPool } from '../features/subagent/pool';
import type { TaskOutputStorePort } from '../features/tasks/output-port';
import { TaskRunner } from '../features/tasks/runner';
import { TaskService } from '../features/tasks/service';
import { TaskSessionFactory } from '../features/tasks/session-factory';
import { TemplateService } from '../features/templates/service';
import { TodoStore } from '../features/todo/store';
import { WebToolsSettingsAdapter } from '../features/web-tools/adapter';
import { WebToolsSettingsStore } from '../features/web-tools/settings';
import { RecoveryStore } from '../features/workspace/recovery';
import { WorkspaceService } from '../features/workspace/service';
import { WorkspaceWatcher } from '../features/workspace/watcher';
import { WritingService } from '../features/writing/service';
import { VersionStore } from '../features/writing/versions';
import { ElectronContextFilePlatform } from '../infra/electron/context-file-platform';
import { createElectronThumbnail } from '../infra/electron/thumbnail';
import { OfficeDocumentParser } from '../integrations/officeparser/parser';
import { TaskOutputRouter } from './task-output-router';

export type AppContext = {
  settingsService: SettingsService;
  workspaceService: WorkspaceService;
  sessionRepository: JsonlSessionRepository;
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
  indexService: WorkspaceIndexWorker;
  libraryService: LibraryService;
  writingService: WritingService;
  templateService: TemplateService;
  reviewService: ReviewService;
  settlementService: SettlementService;
  permissionBroker: PermissionBroker;
  permissionRuleStore: PermissionRuleStore;
  /** 权限设置页使用 UI 当前 workspace；工具调用授权仍由会话 ctx 绑定。 */
  getPermissionSettingsCwd: () => Promise<string | null>;
  /** Pending 面板只按 UI 当前 workspace 拉取，避免复用会话工具闭包 cwd。 */
  getMemoryPendingCwd: () => Promise<string>;
};

export function createAppContext(): AppContext {
  const settingsService = new SettingsService(new WebToolsSettingsAdapter());
  const indexService = new WorkspaceIndexWorker(path.join(settingsService.rootDir, 'cache'));
  const versions = new VersionStore(async cwd => (await indexService.listAssets(cwd)).assets);
  const workspaceService = new WorkspaceService(
    settingsService,
    {},
    new WorkspaceWatcher(),
    new RecoveryStore(path.join(settingsService.rootDir, 'cache')),
    (next, previous) => versions.preserveFinalization(next, previous)
  );
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
  const sessionRepository = new JsonlSessionRepository({
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
  const libraryService = new LibraryService(workspaceService, indexService);
  const templateService = new TemplateService(workspaceService, path.join(settingsService.rootDir, 'templates'));
  workspaceService.onChange(event => {
    void indexService
      .invalidate(
        event.rootPath,
        event.changes.map(change => change.relativePath)
      )
      .catch(error => console.error('索引失效通知失败:', error));
  });
  const memorySearchService = new MemorySearchService({
    indexSearch: (cwd, query, options) => indexService.search(cwd, query, options),
    literalSearch: { search: input => indexService.literalSearch(input) },
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
    skillsProvider,
    buildTaskTools: (spec, cwd, onMemoryRead) => buildTaskSessionTools({ spec, cwd, memorySearchService, onMemoryRead })
  });
  const taskRunner = new TaskRunner(taskSessionFactory, runStore, taskOutputStore, toolCatalog);
  const taskService = new TaskService({ settingsService, personaRegistry, taskRunner, contextFileService });
  const reviewWorkflowStore = new ReviewWorkflowStore();
  const writingService = new WritingService({
    workspace: workspaceService,
    library: libraryService,
    personas: personaRegistry,
    models: modelService,
    tasks: taskRunner,
    versions,
    readReview: (rootPath, id) => reviewWorkflowStore.read(rootPath, id)
  });
  const reviewService = new ReviewService({
    workspace: workspaceService,
    library: libraryService,
    personas: personaRegistry,
    models: modelService,
    tasks: taskRunner,
    candidates: writingService.candidates,
    store: reviewWorkflowStore
  });
  const settlementService = new SettlementService({
    workspace: workspaceService,
    library: libraryService,
    personas: personaRegistry,
    models: modelService,
    tasks: taskRunner,
    versions: writingService.candidates.versions
  });

  // 会话压缩 = 创作检查点管线：memory-distiller 蒸馏出结构化检查点并原子落盘，
  // 同一正文才写入会话流；任一步失败即取消压缩，不留半截状态。
  const memoryService = new MemoryService({
    chaptaleRootDir: settingsService.rootDir,
    listAssets: cwd => indexService.listAssets(cwd)
  });
  const compactCoord = new CompactCoord({
    personas: personaRegistry,
    tasks: taskRunner,
    memory: memoryService,
    summaries: new CompactionSummaryStore()
  });

  // chat 链路（自有）：systemPrompt 经 persona 三层覆盖解析。
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
    modelService,
    // 闸门由 bundle 按轮产出：只有它同时握有会话 cwd 与三层规则，能让 workspace 级授权真正命中。
    permissionBroker,
    permissionRuleStore
  });
  const agentRuntime = new AgentService({
    sessionRepository,
    modelService,
    runtimeBundle,
    contextFileService,
    imageAttachmentService,
    memoryInjector: new MemoryInjector(memoryService),
    compactSummarizer: input => compactCoord.run(input)
  });

  return {
    settingsService,
    workspaceService,
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
    libraryService,
    writingService,
    templateService,
    reviewService,
    settlementService,
    permissionBroker,
    permissionRuleStore,
    getPermissionSettingsCwd: () => settingsService.getCurrentCwd(),
    getMemoryPendingCwd: () => settingsService.getCurrentCwd()
  };
}
