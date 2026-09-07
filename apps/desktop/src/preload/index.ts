import { contextBridge } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

import { createAgentApi } from './api/agent';
import { createGetPlatformApi } from './api/app';
import { createSlashCommandsApi } from './api/commands';
import { createLibraryApi } from './api/library';
import { createMemoryApi } from './api/memory';
import { createModelsApi } from './api/models';
import { createPermissionsApi } from './api/permissions';
import { createPromptSettingsApi } from './api/prompts';
import { createReviewsApi } from './api/reviews';
import { createSessionApi } from './api/sessions';
import { createSettingsApi } from './api/settings';
import { createSubagentApi } from './api/subagent';
import { createTasksApi } from './api/tasks';
import { createTodosApi } from './api/todos';
import { createWindowControlApi } from './api/window';
import { createWorkspaceApi } from './api/workspace';
import { createWritingApi } from './api/writing';

const desktopApi: ChaptaleDesktopApi = {
  writing: createWritingApi(),
  reviews: createReviewsApi(),
  library: createLibraryApi(),
  workspace: createWorkspaceApi(),
  getPlatform: createGetPlatformApi(),
  windowControl: createWindowControlApi(),
  session: createSessionApi(),
  settings: createSettingsApi(),
  promptSettings: createPromptSettingsApi(),
  slashCommands: createSlashCommandsApi(),
  models: createModelsApi(),
  agent: createAgentApi(),
  tasks: createTasksApi(),
  todos: createTodosApi(),
  memory: createMemoryApi(),
  subagent: createSubagentApi(),
  permissions: createPermissionsApi()
};

contextBridge.exposeInMainWorld('chaptaleDesktop', desktopApi);

export type { ChaptaleDesktopApi };
