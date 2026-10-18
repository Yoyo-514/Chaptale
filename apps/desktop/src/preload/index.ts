import { contextBridge } from 'electron';

import type { ChaptaleDesktopApi } from '@chaptale/ipc-contract';

import { createAgentHostApi } from './api/agent-host';
import { createEditCommandApi, createGetPlatformApi } from './api/app';
import { createCloudSyncApi } from './api/cloud-sync';
import { createSettingsApi } from './api/settings';
import { createWindowControlApi } from './api/window';
import { createWorkspaceApi } from './api/workspace';

const desktopApi: ChaptaleDesktopApi = {
  agentHost: createAgentHostApi(),
  workspace: createWorkspaceApi(),
  cloudSync: createCloudSyncApi(),
  getPlatform: createGetPlatformApi(),
  editCommand: createEditCommandApi(),
  windowControl: createWindowControlApi(),
  settings: createSettingsApi()
};

contextBridge.exposeInMainWorld('chaptaleDesktop', desktopApi);

export type { ChaptaleDesktopApi };
