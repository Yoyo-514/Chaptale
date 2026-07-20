import { PiAgentService } from '../integrations/pi/agent/service';
import { PiAgentSessionFactory, createDefaultPersonaRegistry } from '../integrations/pi/agent/session-factory';
import { TaskRunner } from '../integrations/pi/agent/task-runner';
import { PiModelService } from '../integrations/pi/models/service';
import { PiWebAccessAdapter } from '../integrations/pi/web-access/config-mapper';
import { PiSessionRepository } from '../integrations/pi/sessions/repository';
import { SlashCommandService } from '../modules/commands/service';

import { PromptFileService } from '../modules/prompts/file-service';
import { AgentRunStore } from '../modules/runs/store';
import { SettingsService } from '../modules/settings/service';
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
};

export function createAppContext(): AppContext {
  const webAccessAdapter = new PiWebAccessAdapter();
  const settingsService = new SettingsService(webAccessAdapter);
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
  const sessionFactory = new PiAgentSessionFactory({
    settingsService,
    modelService,
    skillsProvider: agentRuntime.skillsProvider,
    todoStore: agentRuntime.todoStore
  });
  // runs 归属工作区（<workspace>/.chaptale/runs）：审查历史是创作产物，随作品同步。
  const runStore = new AgentRunStore({ resolveCwd: () => settingsService.getCurrentCwd() });
  const taskRunner = new TaskRunner(sessionFactory, runStore);
  const taskService = new TaskService({ settingsService, personaRegistry, taskRunner });

  return {
    settingsService,
    sessionRepository,
    modelService,
    agentRuntime,
    promptFileService,
    commandService,
    taskService,
    runStore,
    todoStore: agentRuntime.todoStore
  };
}
