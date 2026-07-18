import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';
import { contextBridge } from 'electron';

import { createAgentApi } from './api/agent';
import { createGetPlatformApi } from './api/app';
import { createSlashCommandsApi } from './api/commands';
import { createModelsApi } from './api/models';
import { createPromptSettingsApi } from './api/prompts';
import { createSessionApi } from './api/sessions';
import { createSettingsApi } from './api/settings';
import { createWindowControlApi } from './api/window';

const desktopApi: ChaptaleDesktopApi = {
  getPlatform: createGetPlatformApi(),
  windowControl: createWindowControlApi(),
  session: createSessionApi(),
  settings: createSettingsApi(),
  promptSettings: createPromptSettingsApi(),
  slashCommands: createSlashCommandsApi(),
  models: createModelsApi(),
  agent: createAgentApi()
};

contextBridge.exposeInMainWorld('chaptaleDesktop', desktopApi);

export type { ChaptaleDesktopApi };
