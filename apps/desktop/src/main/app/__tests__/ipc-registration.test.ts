import { beforeEach, describe, expect, it, vi } from 'vitest';

import { EditCommandValidator } from '../../../bridge/app';
import { IPC_CHANNELS } from '../../../bridge/channels';
import {
  CloudListFoldersArgsValidator,
  CloudNoArgsValidator,
  CloudProviderArgsValidator
} from '../../../bridge/schemas/cloud-sync';
import { ChooseDataDirectoryArgsValidator } from '../../../bridge/schemas/data-directory';
import { UpdateChaptaleSettingsArgsValidator } from '../../../bridge/schemas/settings';
import { WindowCompleteCloseArgsValidator, WindowZoomArgsValidator } from '../../../bridge/window';
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
  trusted(IPC_CHANNELS.settings.openConfigDir),
  trusted(IPC_CHANNELS.dataDirectory.status),
  trusted(IPC_CHANNELS.dataDirectory.select),
  validated(IPC_CHANNELS.dataDirectory.choose, ChooseDataDirectoryArgsValidator),
  validated(IPC_CHANNELS.cloudSync.getState, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.beginAuth, CloudProviderArgsValidator),
  validated(IPC_CHANNELS.cloudSync.cancelAuth, CloudNoArgsValidator),
  validated(IPC_CHANNELS.cloudSync.signOut, CloudProviderArgsValidator),
  validated(IPC_CHANNELS.cloudSync.listFolders, CloudListFoldersArgsValidator),
  trusted(IPC_CHANNELS.window.minimize),
  trusted(IPC_CHANNELS.window.toggleMaximize),
  trusted(IPC_CHANNELS.window.close),
  validated(IPC_CHANNELS.window.completeClose, WindowCompleteCloseArgsValidator),
  trusted(IPC_CHANNELS.window.isMaximized)
];

const mainToRendererEvents = new Set<string>([IPC_CHANNELS.window.closeRequested]);

function createContext(): AppContext {
  return {
    settingsService: {},
    dataDirectory: {},
    cloudSyncService: {}
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
