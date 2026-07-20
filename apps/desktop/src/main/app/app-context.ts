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

export type AppContext = {
  settingsService: SettingsService;
  sessionRepository: PiSessionRepository;
  modelService: PiModelService;
  agentRuntime: PiAgentService;
  promptFileService: PromptFileService;
  commandService: SlashCommandService;
  taskService: TaskService;
  runStore: AgentRunStore;
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
    skillsProvider: agentRuntime.skillsProvider
  });
  const runStore = new AgentRunStore({ cwd: settingsService.rootDir });
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
    runStore
  };
}
