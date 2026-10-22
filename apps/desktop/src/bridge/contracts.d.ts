import type { AgentClient } from '@chaptale/agent-host/protocol';
import type { CreationClient } from '@chaptale/creation/contracts';

import type { AppPlatformResult, EditCommand } from './app';
import type {
  CloudAuthResult,
  CloudListFoldersArgs,
  CloudListFoldersResult,
  CloudProviderArgs,
  CloudSyncState
} from './cloud-sync';
import type { ChaptaleSettingsState, UpdateChaptaleSettingsPayload } from './settings';
import type { WindowStateResult, WindowZoomCommand } from './window';

export interface DesktopAgentClient extends AgentClient {
  onDisconnected(listener: (message: string) => void): () => void;
}

export interface DesktopCreationClient extends CreationClient {
  selectPaths(purpose: 'import-files' | 'import-directory' | 'export-directory'): Promise<string[] | null>;
  onDisconnected(listener: (message: string) => void): () => void;
}

/**
 * Preload 暴露给启用上下文隔离且关闭 Node 集成的 Renderer 的完整能力契约。
 * 该类型只描述可跨进程调用的稳定数据，不允许 Electron、Node 或具体 SDK 类型越过边界。
 */
export type ChaptaleDesktopApi = {
  agentHost: DesktopAgentClient;
  creation: DesktopCreationClient;
  cloudSync: {
    getState: () => Promise<CloudSyncState>;
    /** 打开系统浏览器等待回环回调；授权结束（成功/取消/超时/拒绝）才 resolve。 */
    beginAuth: (args: CloudProviderArgs) => Promise<CloudAuthResult>;
    cancelAuth: () => Promise<void>;
    /** 只清除本机凭据，不调用服务商撤销接口。 */
    signOut: (args: CloudProviderArgs) => Promise<CloudSyncState>;
    listFolders: (args: CloudListFoldersArgs) => Promise<CloudListFoldersResult>;
  };
  getPlatform: () => Promise<AppPlatformResult>;
  editCommand: (command: EditCommand) => Promise<void>;
  windowControl: {
    zoom: (command: WindowZoomCommand) => Promise<number>;
    minimize: () => Promise<WindowStateResult>;
    toggleMaximize: () => Promise<WindowStateResult>;
    close: () => Promise<void>;
    completeClose: (close: boolean) => Promise<void>;
    onCloseRequested: (listener: () => void) => () => void;
    isMaximized: () => Promise<WindowStateResult>;
  };
  settings: {
    getState: () => Promise<ChaptaleSettingsState>;
    update: (payload: UpdateChaptaleSettingsPayload) => Promise<ChaptaleSettingsState>;
    openConfigDir: () => Promise<void>;
  };
};
