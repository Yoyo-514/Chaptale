import type { ChatMessage } from '@chaptale/shared';

export const IPC_CHANNELS = {
  app: {
    getPlatform: 'app:get-platform'
  },
  agent: {
    getHistory: 'agent:get-history',
    start: 'agent:start',
    cancel: 'agent:cancel',
    message: 'agent:message',
    done: 'agent:done',
    error: 'agent:error'
  }
} as const;

export type IpcChannelGroup = typeof IPC_CHANNELS;

export type AppPlatformResult = {
  platform: string;
  versions: Record<string, string>;
};

export type AgentStartPayload = {
  runId: string;
  query: string;
};

export type AgentRunResult = {
  runId: string;
};

export type AgentMessageEvent = {
  runId: string;
  message: ChatMessage;
};

export type AgentDoneEvent = AgentRunResult;

export type AgentErrorEvent = {
  runId: string;
  message: string;
};

export type StreamAgentHandlers = {
  onMessage: (message: ChatMessage) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
};

export type ChaptaleDesktopApi = {
  getPlatform: () => Promise<AppPlatformResult>;
  agent: {
    getHistory: () => Promise<ChatMessage[]>;
    stream: (query: string, handlers: StreamAgentHandlers) => Promise<AgentRunResult>;
    cancel: (runId: string) => Promise<AgentRunResult>;
  };
};
