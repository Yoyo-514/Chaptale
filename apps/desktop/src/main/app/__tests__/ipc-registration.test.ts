import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  ContentContextValidator,
  ContentReadValidator,
  ContentDeleteValidator,
  ContentSaveValidator,
  ContentExportValidator,
  ContentBundleTextValidator,
  ContentPreviewValidator,
  ContentImportValidator,
  CreateWorkspaceArgsValidator,
  EditCommandValidator,
  EntryPathArgsValidator,
  MutateEntryArgsValidator,
  AddCustomModelArgsValidator,
  AddCustomProviderArgsValidator,
  AgentCancelArgsValidator,
  AgentClearPendingMessagesArgsValidator,
  AgentInspectContextFilesArgsValidator,
  AgentStartArgsValidator,
  AgentSteerArgsValidator,
  AgentGetContextPressureArgsValidator,
  AgentCompactSessionArgsValidator,
  MemoryListPendingArgsValidator,
  MemoryInspectPendingArgsValidator,
  MemoryResolvePendingArgsValidator,
  CreateSessionArgsValidator,
  DeleteSessionArgsValidator,
  DeleteSessionsArgsValidator,
  ExportSessionArgsValidator,
  FetchCustomProviderModelsArgsValidator,
  IPC_CHANNELS,
  PermissionsDecideArgsValidator,
  PermissionsListRulesArgsValidator,
  PermissionsPendingArgsValidator,
  PermissionsRemoveRuleArgsValidator,
  ReadSessionImageArgsValidator,
  RemoveCustomModelArgsValidator,
  RemoveCustomProviderApiKeyArgsValidator,
  RenameSessionArgsValidator,
  SessionIdArgsValidator,
  SetCustomProviderApiKeyArgsValidator,
  SetDefaultModelArgsValidator,
  SetSessionLeafArgsValidator,
  TaskCancelArgsValidator,
  TaskListRunsArgsValidator,
  TaskRunArgsValidator,
  TodosGetArgsValidator,
  SubagentListActiveArgsValidator,
  SubagentCancelArgsValidator,
  TaskReadRunOutputArgsValidator,
  UpdateChaptaleSettingsArgsValidator,
  UpdateCustomModelInputArgsValidator,
  UpdateWebToolsSettingsArgsValidator,
  UpdatePromptSettingsArgsValidator,
  WorkspaceGetStateArgsValidator,
  SelectDirectoryArgsValidator,
  ListDirectoryArgsValidator,
  CreateEntryArgsValidator,
  ReadDocumentArgsValidator,
  WriteDocumentArgsValidator,
  WorkspaceRootArgsValidator,
  CreateChapterArgsValidator,
  WindowCompleteCloseArgsValidator,
  RecoveryPathArgsValidator,
  SaveRecoveryArgsValidator,
  LibraryLinkArgsValidator,
  WorkspaceSearchArgsValidator,
  SceneReferencesValidator,
  ComposePackArgsValidator,
  PackIdArgsValidator,
  DraftRequestValidator,
  CreateAssetValidator,
  IdentifyAssetValidator,
  RewriteSelectionValidator,
  RewriteRequestValidator,
  CandidateIdArgsValidator,
  ApplyCandidateValidator,
  WritingTargetValidator,
  SnapshotReadValidator,
  FinalizeChapterValidator,
  RestoreVersionValidator,
  ReviewRunValidator,
  ReviewIdValidator,
  ResolveIssueValidator,
  ResolveReviewFeedbackValidator,
  SettlementValidators
} from '@chaptale/ipc-contract';

import { WorkspaceService } from '../../features/workspace/service';
import type { AppContext } from '../app-context';
import { registerApplicationIpc } from '../ipc-registry';

type IpcValidator = { Check(value: unknown): boolean };
type Registration =
  | { kind: 'trusted'; channel: string }
  | { kind: 'validated'; channel: string; validator: IpcValidator };

const registrationMock = vi.hoisted(() => ({
  registrations: [] as Registration[]
}));

const memoryIpcMock = vi.hoisted(() => ({
  registerMemoryIpc: vi.fn()
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

vi.mock('../../features/memory/ipc', async () => {
  const actual = await vi.importActual<typeof import('../../features/memory/ipc')>('../../features/memory/ipc');

  return {
    ...actual,
    registerMemoryIpc: ((...args: Parameters<typeof actual.registerMemoryIpc>) => {
      memoryIpcMock.registerMemoryIpc(...args);
      return actual.registerMemoryIpc(...args);
    }) as typeof actual.registerMemoryIpc
  };
});

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
  validated(IPC_CHANNELS.content.list, ContentContextValidator),
  validated(IPC_CHANNELS.content.read, ContentReadValidator),
  validated(IPC_CHANNELS.content.save, ContentSaveValidator),
  validated(IPC_CHANNELS.content.archive, ContentReadValidator),
  validated(IPC_CHANNELS.content.restore, ContentReadValidator),
  validated(IPC_CHANNELS.content.previewDelete, ContentReadValidator),
  validated(IPC_CHANNELS.content.delete, ContentDeleteValidator),
  validated(IPC_CHANNELS.content.previewExport, ContentExportValidator),
  validated(IPC_CHANNELS.content.saveExport, ContentBundleTextValidator),
  validated(IPC_CHANNELS.content.previewImport, ContentPreviewValidator),
  validated(IPC_CHANNELS.content.import, ContentImportValidator),
  ...Object.entries(SettlementValidators).map(([key, validator]) =>
    validated(IPC_CHANNELS.settlement[key as keyof typeof SettlementValidators], validator)
  ),
  trusted(IPC_CHANNELS.app.getPlatform),
  validated(IPC_CHANNELS.app.editCommand, EditCommandValidator),
  validated(IPC_CHANNELS.templates.list, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.templates.create, CreateAssetValidator),
  validated(IPC_CHANNELS.templates.identify, IdentifyAssetValidator),
  validated(IPC_CHANNELS.reviews.run, ReviewRunValidator),
  validated(IPC_CHANNELS.reviews.cancel, ReviewIdValidator),
  validated(IPC_CHANNELS.reviews.list, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.reviews.read, ReviewIdValidator),
  validated(IPC_CHANNELS.reviews.resolve, ResolveIssueValidator),
  validated(IPC_CHANNELS.reviews.feedback, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.reviews.resolveFeedback, ResolveReviewFeedbackValidator),
  validated(IPC_CHANNELS.writing.generate, DraftRequestValidator),
  validated(IPC_CHANNELS.writing.prepareRewrite, RewriteSelectionValidator),
  validated(IPC_CHANNELS.writing.rewrite, RewriteRequestValidator),
  validated(IPC_CHANNELS.writing.cancel, CandidateIdArgsValidator),
  validated(IPC_CHANNELS.writing.listCandidates, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.writing.readCandidate, CandidateIdArgsValidator),
  validated(IPC_CHANNELS.writing.discard, CandidateIdArgsValidator),
  validated(IPC_CHANNELS.writing.apply, ApplyCandidateValidator),
  validated(IPC_CHANNELS.writing.listVersions, WritingTargetValidator),
  validated(IPC_CHANNELS.writing.readVersion, SnapshotReadValidator),
  validated(IPC_CHANNELS.writing.finalizeChapter, FinalizeChapterValidator),
  validated(IPC_CHANNELS.writing.restoreVersion, RestoreVersionValidator),

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
  validated(IPC_CHANNELS.settings.updateWebTools, UpdateWebToolsSettingsArgsValidator),
  trusted(IPC_CHANNELS.settings.selectWorkspaceDir),
  trusted(IPC_CHANNELS.settings.openConfigDir),

  validated(IPC_CHANNELS.workspace.getState, WorkspaceGetStateArgsValidator),
  validated(IPC_CHANNELS.workspace.getSyncState, WorkspaceGetStateArgsValidator),
  validated(IPC_CHANNELS.workspace.revealSyncRoot, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.workspace.selectParent, SelectDirectoryArgsValidator),
  validated(IPC_CHANNELS.workspace.createWorkspace, CreateWorkspaceArgsValidator),
  validated(IPC_CHANNELS.workspace.inspectEntry, EntryPathArgsValidator),
  validated(IPC_CHANNELS.workspace.mutateEntry, MutateEntryArgsValidator),
  validated(IPC_CHANNELS.workspace.revealEntry, EntryPathArgsValidator),
  validated(IPC_CHANNELS.workspace.listDirectory, ListDirectoryArgsValidator),
  validated(IPC_CHANNELS.workspace.createEntry, CreateEntryArgsValidator),
  validated(IPC_CHANNELS.workspace.readDocument, ReadDocumentArgsValidator),
  validated(IPC_CHANNELS.workspace.writeDocument, WriteDocumentArgsValidator),
  validated(IPC_CHANNELS.workspace.getLayout, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.workspace.createChapter, CreateChapterArgsValidator),
  validated(IPC_CHANNELS.workspace.listRecoveries, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.workspace.readRecovery, RecoveryPathArgsValidator),
  validated(IPC_CHANNELS.workspace.saveRecovery, SaveRecoveryArgsValidator),
  validated(IPC_CHANNELS.workspace.discardRecovery, RecoveryPathArgsValidator),
  validated(IPC_CHANNELS.library.listAssets, WorkspaceRootArgsValidator),
  validated(IPC_CHANNELS.library.search, WorkspaceSearchArgsValidator),
  validated(IPC_CHANNELS.library.sceneReferences, SceneReferencesValidator),
  validated(IPC_CHANNELS.library.resolveLink, LibraryLinkArgsValidator),
  validated(IPC_CHANNELS.library.composePack, ComposePackArgsValidator),
  validated(IPC_CHANNELS.library.freezePack, ComposePackArgsValidator),
  validated(IPC_CHANNELS.library.readPack, PackIdArgsValidator),
  validated(IPC_CHANNELS.library.checkPack, PackIdArgsValidator),

  trusted(IPC_CHANNELS.promptSettings.getState),
  validated(IPC_CHANNELS.promptSettings.update, UpdatePromptSettingsArgsValidator),

  trusted(IPC_CHANNELS.models.list),
  validated(IPC_CHANNELS.models.setDefault, SetDefaultModelArgsValidator),
  validated(IPC_CHANNELS.models.fetchCustomProviderModels, FetchCustomProviderModelsArgsValidator),
  validated(IPC_CHANNELS.models.addCustomProvider, AddCustomProviderArgsValidator),
  validated(IPC_CHANNELS.models.addCustomModel, AddCustomModelArgsValidator),
  validated(IPC_CHANNELS.models.setCustomProviderApiKey, SetCustomProviderApiKeyArgsValidator),
  validated(IPC_CHANNELS.models.removeCustomProviderApiKey, RemoveCustomProviderApiKeyArgsValidator),
  validated(IPC_CHANNELS.models.updateCustomModelInput, UpdateCustomModelInputArgsValidator),
  validated(IPC_CHANNELS.models.removeCustomModel, RemoveCustomModelArgsValidator),

  trusted(IPC_CHANNELS.agent.selectContextFiles),
  validated(IPC_CHANNELS.agent.inspectContextFiles, AgentInspectContextFilesArgsValidator),
  validated(IPC_CHANNELS.agent.start, AgentStartArgsValidator),
  validated(IPC_CHANNELS.agent.steer, AgentSteerArgsValidator),
  validated(IPC_CHANNELS.agent.clearPendingMessages, AgentClearPendingMessagesArgsValidator),
  validated(IPC_CHANNELS.agent.cancel, AgentCancelArgsValidator),
  validated(IPC_CHANNELS.agent.getContextPressure, AgentGetContextPressureArgsValidator),
  validated(IPC_CHANNELS.agent.compactSession, AgentCompactSessionArgsValidator),

  trusted(IPC_CHANNELS.slashCommands.list),

  validated(IPC_CHANNELS.tasks.run, TaskRunArgsValidator),
  validated(IPC_CHANNELS.tasks.cancel, TaskCancelArgsValidator),
  validated(IPC_CHANNELS.tasks.listRuns, TaskListRunsArgsValidator),
  validated(IPC_CHANNELS.tasks.readRunOutput, TaskReadRunOutputArgsValidator),

  validated(IPC_CHANNELS.todos.get, TodosGetArgsValidator),

  validated(IPC_CHANNELS.subagent.listActive, SubagentListActiveArgsValidator),
  validated(IPC_CHANNELS.subagent.cancel, SubagentCancelArgsValidator),

  validated(IPC_CHANNELS.memory.listPending, MemoryListPendingArgsValidator),
  validated(IPC_CHANNELS.memory.inspectPending, MemoryInspectPendingArgsValidator),
  validated(IPC_CHANNELS.memory.resolvePending, MemoryResolvePendingArgsValidator),

  validated(IPC_CHANNELS.permissions.pending, PermissionsPendingArgsValidator),
  validated(IPC_CHANNELS.permissions.decide, PermissionsDecideArgsValidator),
  validated(IPC_CHANNELS.permissions.listRules, PermissionsListRulesArgsValidator),
  validated(IPC_CHANNELS.permissions.removeRule, PermissionsRemoveRuleArgsValidator),

  trusted(IPC_CHANNELS.window.minimize),
  trusted(IPC_CHANNELS.window.toggleMaximize),
  trusted(IPC_CHANNELS.window.close),
  validated(IPC_CHANNELS.window.completeClose, WindowCompleteCloseArgsValidator),
  trusted(IPC_CHANNELS.window.isMaximized)
];

const mainToRendererEvents = new Set<string>([
  IPC_CHANNELS.agent.message,
  IPC_CHANNELS.agent.end,
  IPC_CHANNELS.todos.updated,
  IPC_CHANNELS.subagent.event,
  IPC_CHANNELS.memory.pendingChanged,
  IPC_CHANNELS.permissions.ask,
  IPC_CHANNELS.window.closeRequested,
  IPC_CHANNELS.workspace.changed
]);

function createContext(): AppContext {
  return {
    settingsService: {},
    workspaceService: new WorkspaceService({
      getStorageContext: async () => ({ storageMode: 'global' as const, workspacePath: undefined })
    }),
    sessionRepository: {},
    modelService: {},
    agentRuntime: {},
    contextFileService: {},
    promptFileService: {},
    commandService: {},
    taskService: { start: async () => ({ status: 'cancelled', runId: 'run-1' }), cancel: () => undefined },
    runStore: { list: async () => ({ records: [], diagnostics: [] }) },
    taskOutputStore: {
      saveSuccess: async () => '.chaptale/reviews/run-1.json',
      saveFailure: async () => '.chaptale/runs/outputs/run-1.json',
      read: async () => null,
      remove: async () => undefined
    },
    todoStore: { onChange: () => () => undefined, remove: async () => undefined },
    subagentPool: { onEvent: () => () => undefined, listActive: () => [], cancel: () => undefined },
    memoryPendingStore: { onChange: () => () => undefined, list: async () => ({ proposals: [], diagnostics: [] }) },
    permissionBroker: { onAsk: () => undefined, listPending: () => [], rejectSession: () => undefined },
    permissionRuleStore: {
      addRule: async () => undefined,
      listPersistentRules: async () => ({ workspace: [], global: [] }),
      removePersistentRule: async () => undefined,
      clearSession: () => undefined
    },
    getMemoryPendingCwd: vi.fn(async () => '/workspace/memory-pending'),
    getPermissionSettingsCwd: vi.fn(async () => '/workspace/permissions')
  } as unknown as AppContext;
}

describe('renderer → main IPC 注册边界', () => {
  beforeEach(() => {
    registrationMock.registrations.length = 0;
    memoryIpcMock.registerMemoryIpc.mockClear();
  });

  it('分类表完整覆盖全部请求频道且不包含 main → renderer 事件', () => {
    const allRequestChannels = Object.values(IPC_CHANNELS)
      .flatMap(group => Object.values(group))
      .filter(channel => !mainToRendererEvents.has(channel));
    const classifiedChannels = expectedRegistrations.map(registration => registration.channel);

    expect(new Set(classifiedChannels).size).toBe(classifiedChannels.length);
    expect(classifiedChannels.toSorted()).toEqual(allRequestChannels.toSorted());
  });

  it('调用应用注册表时为每个频道选择 trusted 或对应 validator', () => {
    const context = createContext();

    registerApplicationIpc(context);

    const actualByChannel = new Map(
      registrationMock.registrations.map(registration => [registration.channel, registration])
    );
    expect(actualByChannel.size).toBe(expectedRegistrations.length);

    // 只比对频道→机制/validator 契约，不绑定注册顺序（顺序是实现细节）。
    for (const expected of expectedRegistrations) {
      const actual = actualByChannel.get(expected.channel);

      expect(actual?.kind).toBe(expected.kind);

      if (expected.kind === 'validated') {
        expect(actual?.kind).toBe('validated');

        if (actual?.kind === 'validated') {
          expect(actual.validator).toBe(expected.validator);
        }
      }
    }

    expect(memoryIpcMock.registerMemoryIpc).toHaveBeenCalledTimes(1);
    expect(memoryIpcMock.registerMemoryIpc).toHaveBeenCalledWith(
      context.memoryPendingStore,
      expect.objectContaining({ broadcast: expect.any(Function) }),
      {
        resolveCwd: context.getMemoryPendingCwd
      }
    );
  });
});
