import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { HostCommands, HostEvent } from '@chaptale/agent-host/protocol';
import type { CreationCommands, CreationEvent } from '@chaptale/creation/contracts';

import { APPLICATION_HOST_CHANNELS } from '../bridge/channels';
import type { ChaptaleDesktopApi } from '../bridge/contracts';
import { createEditCommandApi, createGetPlatformApi } from './api/app';
import { createCloudSyncApi } from './api/cloud-sync';
import { createDataDirectoryApi } from './api/data-directory';
import { createHelpApi } from './api/help';
import { createHostApi } from './api/host';
import { createScheduledBackupApi } from './api/scheduled-backup';
import { createSettingsApi } from './api/settings';
import { createWindowControlApi } from './api/window';

const desktopApi: ChaptaleDesktopApi = {
  agentHost: {
    ...createHostApi<HostCommands, HostEvent>(APPLICATION_HOST_CHANNELS.agent),
    selectSkillSource: kind => ipcRenderer.invoke(APPLICATION_HOST_CHANNELS.agent.selectSkillSource, kind),
    revealSkillPath: input => ipcRenderer.invoke(APPLICATION_HOST_CHANNELS.agent.revealSkillPath, input)
  },
  creation: {
    ...createHostApi<CreationCommands, CreationEvent>(APPLICATION_HOST_CHANNELS.creation),
    selectPaths: purpose => ipcRenderer.invoke(APPLICATION_HOST_CHANNELS.creation.selectPaths, purpose),
    selectPackageSavePath: title => ipcRenderer.invoke(APPLICATION_HOST_CHANNELS.creation.selectPackageSavePath, title),
    fileAction: (target, action) => ipcRenderer.invoke(APPLICATION_HOST_CHANNELS.creation.fileAction, target, action),
    readFile: target => ipcRenderer.invoke(APPLICATION_HOST_CHANNELS.creation.readFile, target),
    pathForFile: file => webUtils.getPathForFile(file),
    addFileData: input => ipcRenderer.invoke(APPLICATION_HOST_CHANNELS.creation.addFileData, input)
  },
  cloudSync: createCloudSyncApi(),
  scheduledBackup: createScheduledBackupApi(),
  getPlatform: createGetPlatformApi(),
  editCommand: createEditCommandApi(),
  help: createHelpApi(),
  windowControl: createWindowControlApi(),
  dataDirectory: createDataDirectoryApi(),
  settings: createSettingsApi()
};

contextBridge.exposeInMainWorld('chaptaleDesktop', desktopApi);
