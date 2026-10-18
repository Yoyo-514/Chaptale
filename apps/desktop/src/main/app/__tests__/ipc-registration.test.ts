import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  CloudArchiveArgsValidator,
  CloudArchiveListArgsValidator,
  CloudBindArgsValidator,
  CloudListFoldersArgsValidator,
  CloudNoArgsValidator,
  CloudProviderArgsValidator,
  CloudRestoreArgsValidator,
  CloudRestoreDiffArgsValidator,
  CreateWorkspaceArgsValidator,
  EditCommandValidator,
  EntryPathArgsValidator,
  MutateEntryArgsValidator,
  IPC_CHANNELS,
  UpdateChaptaleSettingsArgsValidator,
  WorkspaceGetStateArgsValidator,
  SelectDirectoryArgsValidator,
  ListDirectoryArgsValidator,
  CreateEntryArgsValidator,
  ReadDocumentArgsValidator,
  WriteDocumentArgsValidator,
  WorkspaceRootArgsValidator,
  CreateChapterArgsValidator,
  WindowCompleteCloseArgsValidator,
  WindowZoomArgsValidator,
  RecoveryPathArgsValidator,
  SaveRecoveryArgsValidator
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
  validated(IPC_CHANNELS.window.zoom, WindowZoomArgsValidator),
  trusted(IPC_CHANNELS.app.getPlatform),
  validated(IPC_CHANNELS.app.editCommand, EditCommandValidator),
  trusted(IPC_CHANNELS.settings.getState),
  validated(IPC_CHANNELS.settings.update, UpdateChaptaleSettingsArgsValidator),
  trusted(IPC_CHANNELS.settings.selectWorkspaceDir),
  trusted(IPC_CHANNELS.settings.openConfigDir),
  validated(IPC_CHANNELS.workspace.getState, WorkspaceGetStateArgsValidator),
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
  validated(IPC_CHANNELS.cloudSync.getState, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.getBinding, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.beginAuth, CloudProviderArgsValidator),
  validated(IPC_CHANNELS.cloudSync.cancelAuth, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.signOut, CloudProviderArgsValidator),
  validated(IPC_CHANNELS.cloudSync.listFolders, CloudListFoldersArgsValidator),
  validated(IPC_CHANNELS.cloudSync.bind, CloudBindArgsValidator),
  validated(IPC_CHANNELS.cloudSync.unbind, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.listBackups, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.createBackup, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.planRestore, CloudArchiveArgsValidator),
  validated(IPC_CHANNELS.cloudSync.readRestoreDiff, CloudRestoreDiffArgsValidator),
  validated(IPC_CHANNELS.cloudSync.applyRestore, CloudRestoreArgsValidator),
  validated(IPC_CHANNELS.cloudSync.cancelRestore, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.removeBackups, CloudArchiveListArgsValidator),
  trusted(IPC_CHANNELS.window.minimize),
  trusted(IPC_CHANNELS.window.toggleMaximize),
  trusted(IPC_CHANNELS.window.close),
  validated(IPC_CHANNELS.window.completeClose, WindowCompleteCloseArgsValidator),
  trusted(IPC_CHANNELS.window.isMaximized)
];

const mainToRendererEvents = new Set<string>([
  IPC_CHANNELS.window.closeRequested,
  IPC_CHANNELS.workspace.changed,
  IPC_CHANNELS.cloudSync.backupProgress
]);

function createContext(): AppContext {
  return {
    settingsService: {},
    workspaceService: new WorkspaceService({ getStorageContext: async () => ({ workspacePath: undefined }) }),
    cloudSyncService: { onProgress: () => () => undefined }
  } as unknown as AppContext;
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
  });
});
