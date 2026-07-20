import {
  AddCustomModelArgsValidator,
  AddCustomProviderArgsValidator,
  AgentCancelArgsValidator,
  AgentClearPendingMessagesArgsValidator,
  AgentInspectContextFilesArgsValidator,
  AgentStartArgsValidator,
  AgentSteerArgsValidator,
  CreateSessionArgsValidator,
  DeleteSessionArgsValidator,
  DeleteSessionsArgsValidator,
  ExportSessionArgsValidator,
  FetchCustomProviderModelsArgsValidator,
  IPC_CHANNELS,
  ReadSessionImageArgsValidator,
  RemoveCustomModelArgsValidator,
  RemoveCustomProviderApiKeyArgsValidator,
  RemoveProviderAuthArgsValidator,
  RenameSessionArgsValidator,
  SessionIdArgsValidator,
  SetCustomProviderApiKeyArgsValidator,
  SetDefaultModelArgsValidator,
  SetProviderApiKeyArgsValidator,
  SetSessionLeafArgsValidator,
  TaskCancelArgsValidator,
  TaskListRunsArgsValidator,
  TaskRunArgsValidator,
  UpdateChaptaleSettingsArgsValidator,
  UpdateCustomModelInputArgsValidator,
  UpdatePiWebAccessSettingsArgsValidator,
  UpdatePromptSettingsArgsValidator
} from '@chaptale/ipc-contract';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { registerApplicationIpc } from '../ipc-registry';

import type { AppContext } from '../app-context';

type IpcValidator = { Check(value: unknown): boolean };
type Registration =
  | { kind: 'trusted'; channel: string }
  | { kind: 'validated'; channel: string; validator: IpcValidator };

const registrationMock = vi.hoisted(() => ({
  registrations: [] as Registration[]
}));

vi.mock('../../infra/security/trusted-ipc', () => ({
  handleTrustedIpc: vi.fn((channel: string) => {
    registrationMock.registrations.push({ kind: 'trusted', channel });
  })
}));

vi.mock('../../infra/security/validated-ipc', () => ({
  handleValidatedIpc: vi.fn((channel: string, validator: IpcValidator) => {
    registrationMock.registrations.push({ kind: 'validated', channel, validator });
  })
}));

vi.mock('electron', () => ({
  BrowserWindow: {
    fromWebContents: vi.fn()
  }
}));

const trusted = (channel: string): Registration => ({ kind: 'trusted', channel });
const validated = (channel: string, validator: IpcValidator): Registration => ({
  kind: 'validated',
  channel,
  validator
});

const expectedRegistrations: Registration[] = [
  trusted(IPC_CHANNELS.app.getPlatform),

  trusted(IPC_CHANNELS.session.list),
  validated(IPC_CHANNELS.session.create, CreateSessionArgsValidator),
  validated(IPC_CHANNELS.session.getEntries, SessionIdArgsValidator),
  validated(IPC_CHANNELS.session.getMessages, SessionIdArgsValidator),
  validated(IPC_CHANNELS.session.readImage, ReadSessionImageArgsValidator),
  validated(IPC_CHANNELS.session.rename, RenameSessionArgsValidator),
  validated(IPC_CHANNELS.session.exportHtml, ExportSessionArgsValidator),
  validated(IPC_CHANNELS.session.delete, DeleteSessionArgsValidator),
  validated(IPC_CHANNELS.session.deleteMany, DeleteSessionsArgsValidator),
  validated(IPC_CHANNELS.session.setLeaf, SetSessionLeafArgsValidator),
  trusted(IPC_CHANNELS.session.getStorageDebugInfo),
  trusted(IPC_CHANNELS.session.openStorageDir),

  trusted(IPC_CHANNELS.settings.getState),
  validated(IPC_CHANNELS.settings.update, UpdateChaptaleSettingsArgsValidator),
  validated(IPC_CHANNELS.settings.updateWebAccess, UpdatePiWebAccessSettingsArgsValidator),
  trusted(IPC_CHANNELS.settings.selectWorkspaceDir),
  trusted(IPC_CHANNELS.settings.openConfigDir),

  trusted(IPC_CHANNELS.promptSettings.getState),
  validated(IPC_CHANNELS.promptSettings.update, UpdatePromptSettingsArgsValidator),

  trusted(IPC_CHANNELS.models.list),
  validated(IPC_CHANNELS.models.setDefault, SetDefaultModelArgsValidator),
  validated(IPC_CHANNELS.models.setProviderApiKey, SetProviderApiKeyArgsValidator),
  validated(IPC_CHANNELS.models.fetchCustomProviderModels, FetchCustomProviderModelsArgsValidator),
  validated(IPC_CHANNELS.models.addCustomProvider, AddCustomProviderArgsValidator),
  validated(IPC_CHANNELS.models.addCustomModel, AddCustomModelArgsValidator),
  validated(IPC_CHANNELS.models.setCustomProviderApiKey, SetCustomProviderApiKeyArgsValidator),
  validated(IPC_CHANNELS.models.removeCustomProviderApiKey, RemoveCustomProviderApiKeyArgsValidator),
  validated(IPC_CHANNELS.models.updateCustomModelInput, UpdateCustomModelInputArgsValidator),
  validated(IPC_CHANNELS.models.removeCustomModel, RemoveCustomModelArgsValidator),
  validated(IPC_CHANNELS.models.removeProviderAuth, RemoveProviderAuthArgsValidator),

  trusted(IPC_CHANNELS.agent.selectContextFiles),
  validated(IPC_CHANNELS.agent.inspectContextFiles, AgentInspectContextFilesArgsValidator),
  validated(IPC_CHANNELS.agent.start, AgentStartArgsValidator),
  validated(IPC_CHANNELS.agent.steer, AgentSteerArgsValidator),
  validated(IPC_CHANNELS.agent.clearPendingMessages, AgentClearPendingMessagesArgsValidator),
  validated(IPC_CHANNELS.agent.cancel, AgentCancelArgsValidator),

  trusted(IPC_CHANNELS.slashCommands.list),

  validated(IPC_CHANNELS.tasks.run, TaskRunArgsValidator),
  validated(IPC_CHANNELS.tasks.cancel, TaskCancelArgsValidator),
  validated(IPC_CHANNELS.tasks.listRuns, TaskListRunsArgsValidator),

  trusted(IPC_CHANNELS.window.minimize),
  trusted(IPC_CHANNELS.window.toggleMaximize),
  trusted(IPC_CHANNELS.window.close),
  trusted(IPC_CHANNELS.window.isMaximized)
];

const mainToRendererEvents = new Set<string>([
  IPC_CHANNELS.agent.message,
  IPC_CHANNELS.agent.done,
  IPC_CHANNELS.agent.error
]);

function createContext(): AppContext {
  return {
    settingsService: {},
    sessionRepository: {},
    modelService: {},
    agentRuntime: {},
    promptFileService: {},
    commandService: {}
  } as AppContext;
}

describe('renderer → main IPC 注册边界', () => {
  beforeEach(() => {
    registrationMock.registrations.length = 0;
  });

  it('分类表完整覆盖全部请求频道且不包含 main → renderer 事件', () => {
    const allRequestChannels = Object.values(IPC_CHANNELS)
      .flatMap(group => Object.values(group))
      .filter(channel => !mainToRendererEvents.has(channel));
    const classifiedChannels = expectedRegistrations.map(registration => registration.channel);

    expect(new Set(classifiedChannels).size).toBe(classifiedChannels.length);
    expect(classifiedChannels.toSorted()).toEqual(allRequestChannels.toSorted());
  });

  it('调用应用注册表时按原顺序为每个频道选择 trusted 或对应 validator', () => {
    registerApplicationIpc(createContext());

    expect(registrationMock.registrations).toHaveLength(expectedRegistrations.length);

    expectedRegistrations.forEach((expected, index) => {
      const actual = registrationMock.registrations[index];

      expect(actual?.channel).toBe(expected.channel);
      expect(actual?.kind).toBe(expected.kind);

      if (expected.kind === 'validated') {
        expect(actual?.kind).toBe('validated');

        if (actual?.kind === 'validated') {
          expect(actual.validator).toBe(expected.validator);
        }
      }
    });
  });
});
