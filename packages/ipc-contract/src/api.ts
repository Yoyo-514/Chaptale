import type { ChatMessage } from '@chaptale/shared';
import type { AgentRunResult, StreamAgentHandlers } from './agent';
import type { AppPlatformResult } from './app';
import type {
  ChaptaleSessionInfoEntry,
  ChaptaleSessionListItem,
  ChaptaleSessionMetadata,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions
} from './session';
import type { WindowStateResult } from './window';

export type ChaptaleDesktopApi = {
  getPlatform: () => Promise<AppPlatformResult>;
  windowControl: {
    minimize: () => Promise<WindowStateResult>;
    toggleMaximize: () => Promise<WindowStateResult>;
    close: () => Promise<void>;
    isMaximized: () => Promise<WindowStateResult>;
  };
  session: {
    list: () => Promise<ChaptaleSessionListItem[]>;
    create: (options?: CreateSessionOptions) => Promise<ChaptaleSessionMetadata>;
    getEntries: (sessionId: string) => Promise<ChaptaleSessionTreeEntry[]>;
    getMessages: (sessionId: string) => Promise<ChatMessage[]>;
    rename: (sessionId: string, name: string) => Promise<ChaptaleSessionInfoEntry>;
    delete: (sessionId: string) => Promise<void>;
    setLeaf: (sessionId: string, leafId: string | null) => Promise<void>;
    getStorageDebugInfo: () => Promise<ChaptaleSessionStorageDebugInfo>;
    openStorageDir: () => Promise<void>;
  };
  agent: {
    getHistory: (sessionId?: string) => Promise<ChatMessage[]>;
    stream: (query: string, handlers: StreamAgentHandlers, sessionId?: string) => Promise<AgentRunResult>;
    cancel: (runId: string) => Promise<AgentRunResult>;
  };
};
