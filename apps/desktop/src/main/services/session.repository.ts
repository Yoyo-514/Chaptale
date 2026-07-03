import type { ChatMessage } from '@chaptale/shared';
import type {
  ChaptaleSessionInfoEntry,
  ChaptaleSessionListItem,
  ChaptaleSessionMetadata,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions
} from '@chaptale/ipc-contract';
import { SessionManager, type SessionEntry, type SessionInfo } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export type PiSessionRepositoryOptions = {
  rootDir: string;
  cwd: string | (() => string | Promise<string>);
  sessionDir: string | (() => string | Promise<string>);
  getStorageContext?: () =>
    | { storageMode?: 'global' | 'workspace'; workspacePath?: string }
    | Promise<{ storageMode?: 'global' | 'workspace'; workspacePath?: string }>;
};

type PiMessage = Parameters<SessionManager['appendMessage']>[0];

type MinimalPiTextContent = {
  type: 'text';
  text: string;
};

type MinimalPiToolCall = {
  type: 'toolCall';
  id: string;
  name: string;
  arguments: Record<string, any>;
};

type MinimalPiAssistantMessage = {
  role: 'assistant';
  content: (MinimalPiTextContent | MinimalPiToolCall)[];
  api: string;
  provider: string;
  model: string;
  usage: {
    input: number;
    output: number;
    cacheRead: number;
    cacheWrite: number;
    totalTokens: number;
    cost: {
      input: number;
      output: number;
      cacheRead: number;
      cacheWrite: number;
      total: number;
    };
  };
  stopReason: 'stop' | 'length' | 'toolUse' | 'error' | 'aborted';
  timestamp: number;
};

type MinimalPiToolResultMessage = {
  role: 'toolResult';
  toolCallId: string;
  toolName: string;
  content: MinimalPiTextContent[];
  isError: boolean;
  timestamp: number;
};

function createZeroUsage(): MinimalPiAssistantMessage['usage'] {
  return {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 0,
    cost: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      total: 0
    }
  };
}

function getTextFromContent(content: unknown) {
  if (typeof content === 'string') {
    return content;
  }

  if (!Array.isArray(content)) {
    return '';
  }

  return content
    .map(item => {
      if (!item || typeof item !== 'object') {
        return '';
      }

      const block = item as Record<string, unknown>;
      if (block.type === 'text' && typeof block.text === 'string') {
        return block.text;
      }

      if (block.type === 'toolCall' && typeof block.name === 'string') {
        return `调用工具：${block.name}`;
      }

      return '';
    })
    .filter(Boolean)
    .join('\n');
}

function toPiMessage(message: ChatMessage): PiMessage {
  const timestamp = Date.now();

  if (message.type === 'user') {
    return {
      role: 'user',
      content: message.payload.content,
      timestamp
    } as PiMessage;
  }

  if (message.type === 'assistant') {
    return {
      role: 'assistant',
      content: [{ type: 'text', text: message.payload.content }],
      api: 'chaptale',
      provider: 'chaptale',
      model: 'chaptale-current',
      usage: createZeroUsage(),
      stopReason: 'stop',
      timestamp
    } satisfies MinimalPiAssistantMessage as PiMessage;
  }

  if (message.type === 'tool_call') {
    return {
      role: 'assistant',
      content: [
        {
          type: 'toolCall',
          id: message.payload.id,
          name: message.payload.name,
          arguments: message.payload.args
        }
      ],
      api: 'chaptale',
      provider: 'chaptale',
      model: 'chaptale-current',
      usage: createZeroUsage(),
      stopReason: 'toolUse',
      timestamp
    } satisfies MinimalPiAssistantMessage as PiMessage;
  }

  if (message.type === 'tool_result') {
    return {
      role: 'toolResult',
      toolCallId: message.payload.tool_call_id,
      toolName: message.payload.name,
      content: [{ type: 'text', text: message.payload.content }],
      isError: false,
      timestamp
    } satisfies MinimalPiToolResultMessage as PiMessage;
  }

  return {
    role: 'user',
    content: message.payload.content,
    timestamp
  } as PiMessage;
}

function fromPiMessage(message: unknown): ChatMessage | undefined {
  if (!message || typeof message !== 'object') {
    return undefined;
  }

  const record = message as Record<string, unknown>;

  if (record.role === 'user') {
    return {
      type: 'user',
      payload: {
        content: getTextFromContent(record.content)
      }
    };
  }

  if (record.role === 'assistant') {
    const content = Array.isArray(record.content) ? record.content : [];
    const toolCall = content.find(item =>
      Boolean(item && typeof item === 'object' && (item as Record<string, unknown>).type === 'toolCall')
    ) as Record<string, unknown> | undefined;

    if (toolCall) {
      return {
        type: 'tool_call',
        payload: {
          id: typeof toolCall.id === 'string' ? toolCall.id : '',
          name: typeof toolCall.name === 'string' ? toolCall.name : 'tool',
          args:
            typeof toolCall.arguments === 'object' && toolCall.arguments !== null
              ? (toolCall.arguments as Record<string, any>)
              : {}
        }
      };
    }

    return {
      type: 'assistant',
      payload: {
        content: getTextFromContent(content)
      }
    };
  }

  if (record.role === 'toolResult') {
    return {
      type: 'tool_result',
      payload: {
        tool_call_id: typeof record.toolCallId === 'string' ? record.toolCallId : '',
        name: typeof record.toolName === 'string' ? record.toolName : 'tool',
        content: getTextFromContent(record.content)
      }
    };
  }

  return undefined;
}

function toEntry(entry: SessionEntry): ChaptaleSessionTreeEntry {
  if (entry.type === 'session_info') {
    return {
      type: 'session_info',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      name: entry.name
    };
  }

  if (entry.type === 'message') {
    return {
      type: 'message',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      message: fromPiMessage(entry.message) ?? {
        type: 'assistant',
        payload: { content: '' }
      }
    };
  }

  if (entry.type === 'compaction') {
    return {
      type: 'compaction',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      summary: entry.summary,
      firstKeptEntryId: entry.firstKeptEntryId,
      tokensBefore: entry.tokensBefore,
      details: entry.details,
      fromHook: entry.fromHook
    };
  }

  if (entry.type === 'branch_summary') {
    return {
      type: 'branch_summary',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      fromId: entry.fromId,
      summary: entry.summary,
      details: entry.details,
      fromHook: entry.fromHook
    };
  }

  if (entry.type === 'label') {
    return {
      type: 'label',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      targetId: entry.targetId,
      label: entry.label
    };
  }

  return {
    type: 'custom',
    id: entry.id,
    parentId: entry.parentId,
    timestamp: entry.timestamp,
    name: entry.type,
    data: entry
  };
}

function flushSessionFile(manager: SessionManager) {
  const internals = manager as unknown as { _rewriteFile?: () => void; flushed?: boolean };
  internals._rewriteFile?.();
  internals.flushed = true;
}

function toListItem(info: SessionInfo): ChaptaleSessionListItem {
  return {
    id: info.id,
    createdAt: info.created.toISOString(),
    cwd: info.cwd,
    path: info.path,
    parentSessionPath: info.parentSessionPath,
    name: info.name,
    updatedAt: info.modified.toISOString(),
    leafId: null,
    messageCount: info.messageCount,
    lastMessagePreview: info.firstMessage || info.allMessagesText.slice(0, 80) || undefined
  };
}

export class PiSessionRepository {
  private readonly leafOverrides = new Map<string, string | null>();

  constructor(private readonly options: PiSessionRepositoryOptions) {}

  async getStorageDebugInfo(): Promise<ChaptaleSessionStorageDebugInfo> {
    const context = (await this.options.getStorageContext?.()) ?? {};

    return {
      rootDir: this.options.rootDir,
      sessionDir: await this.resolveSessionDir(),
      cwd: await this.resolveCwd(),
      storageMode: context.storageMode,
      workspacePath: context.workspacePath
    };
  }

  async ensureSessionDir() {
    const sessionDir = await this.resolveSessionDir();
    await fs.mkdir(sessionDir, { recursive: true });
    return sessionDir;
  }

  async create(options: CreateSessionOptions = {}): Promise<ChaptaleSessionMetadata> {
    const cwd = options.cwd ?? (await this.resolveCwd());
    const sessionDir = await this.ensureSessionDir();
    const manager = SessionManager.create(cwd, sessionDir, {
      id: options.id,
      parentSession: options.parentSessionPath
    });

    if (options.name) {
      manager.appendSessionInfo(options.name);
    }

    flushSessionFile(manager);
    return this.getMetadataFromManager(manager);
  }

  async ensureDefaultSession(): Promise<ChaptaleSessionMetadata> {
    const sessions = await this.list();
    return sessions[0] ?? this.create({ name: '默认会话' });
  }

  async list(): Promise<ChaptaleSessionListItem[]> {
    const [cwd, sessionDir] = await Promise.all([this.resolveCwd(), this.ensureSessionDir()]);
    const items = await SessionManager.list(cwd, sessionDir);
    return items.map(toListItem).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getMetadata(sessionId: string): Promise<ChaptaleSessionMetadata> {
    const manager = await this.openSession(sessionId);
    return this.getMetadataFromManager(manager);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const manager = await this.openSession(sessionId);
    return manager
      .buildSessionContext()
      .messages.map(fromPiMessage)
      .filter((message): message is ChatMessage => message !== undefined);
  }

  async getEntries(sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const manager = await this.openSession(sessionId);
    return manager.getEntries().map(toEntry);
  }

  async getPathToRoot(sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const manager = await this.openSession(sessionId);
    return manager.getBranch().map(toEntry);
  }

  async appendMessage(sessionId: string, message: ChatMessage) {
    const manager = await this.openSession(sessionId);
    const id = manager.appendMessage(toPiMessage(message));
    this.leafOverrides.set(sessionId, id);
    flushSessionFile(manager);
    return toEntry(manager.getEntry(id)!);
  }

  async appendCompaction(
    sessionId: string,
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: unknown
  ) {
    const manager = await this.openSession(sessionId);
    const id = manager.appendCompaction(summary, firstKeptEntryId, tokensBefore, details);
    this.leafOverrides.set(sessionId, id);
    flushSessionFile(manager);
    return toEntry(manager.getEntry(id)!);
  }

  async appendSessionInfo(sessionId: string, name: string): Promise<ChaptaleSessionInfoEntry> {
    const manager = await this.openSession(sessionId);
    const id = manager.appendSessionInfo(name);
    this.leafOverrides.set(sessionId, id);
    flushSessionFile(manager);
    const entry = toEntry(manager.getEntry(id)!);

    if (entry.type !== 'session_info') {
      throw new Error('Failed to append session info');
    }

    return entry;
  }

  async setLeafId(sessionId: string, targetId: string | null): Promise<void> {
    const manager = await this.openSession(sessionId);

    if (targetId) {
      this.leafOverrides.set(sessionId, targetId);
      manager.branch(targetId);
      return;
    }

    this.leafOverrides.set(sessionId, null);
    manager.resetLeaf();
  }

  async delete(sessionId: string): Promise<void> {
    const session = await this.findSessionInfo(sessionId);
    const sessionDir = await this.ensureSessionDir();
    const resolvedSessionPath = path.resolve(session.path);
    const resolvedSessionDir = path.resolve(sessionDir);

    if (!resolvedSessionPath.startsWith(`${resolvedSessionDir}${path.sep}`)) {
      throw new Error(`Refuse to delete session outside current session directory: ${session.path}`);
    }

    await fs.unlink(resolvedSessionPath);
  }

  private async openSession(sessionId: string) {
    const [session, cwd, sessionDir] = await Promise.all([
      this.findSessionInfo(sessionId),
      this.resolveCwd(),
      this.ensureSessionDir()
    ]);
    const manager = SessionManager.open(session.path, sessionDir, cwd);
    const leafOverride = this.leafOverrides.get(sessionId);

    if (leafOverride !== undefined) {
      if (leafOverride) {
        manager.branch(leafOverride);
      } else {
        manager.resetLeaf();
      }
    }

    return manager;
  }

  private async findSessionInfo(sessionId: string) {
    const sessions = await this.list();
    const session = sessions.find(item => item.id === sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return session;
  }

  private getMetadataFromManager(manager: SessionManager): ChaptaleSessionMetadata {
    const header = manager.getHeader();
    const sessionFile = manager.getSessionFile();

    if (!header || !sessionFile) {
      throw new Error('Persistent pi session was not created');
    }

    return {
      id: header.id,
      createdAt: header.timestamp,
      cwd: header.cwd,
      path: sessionFile,
      parentSessionPath: header.parentSession
    };
  }

  private async resolveSessionDir() {
    return typeof this.options.sessionDir === 'function' ? await this.options.sessionDir() : this.options.sessionDir;
  }

  private async resolveCwd() {
    return typeof this.options.cwd === 'function' ? await this.options.cwd() : this.options.cwd;
  }
}
