import type { ChatMessage } from '@chaptale/shared';
import type {
  ChaptaleSessionInfoEntry,
  ChaptaleSessionListItem,
  ChaptaleSessionMetadata,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions
} from '@chaptale/ipc-contract';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import path from 'node:path';

import { toSessionListItem, toSessionTreeEntry } from '../sessions/pi-session-entry.mapper';
import { flushSessionFile } from '../sessions/pi-session-file';
import { fromPiMessage, toPiMessage } from '../sessions/pi-session-message.mapper';

export type PiSessionRepositoryOptions = {
  rootDir: string;
  cwd: string | (() => string | Promise<string>);
  sessionDir: string | (() => string | Promise<string>);
  getStorageContext?: () =>
    | { storageMode?: 'global' | 'workspace'; workspacePath?: string }
    | Promise<{ storageMode?: 'global' | 'workspace'; workspacePath?: string }>;
};

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
    return items.map(toSessionListItem).toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
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
    return manager.getEntries().map(toSessionTreeEntry);
  }

  async getPathToRoot(sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const manager = await this.openSession(sessionId);
    return manager.getBranch().map(toSessionTreeEntry);
  }

  async appendMessage(sessionId: string, message: ChatMessage) {
    const manager = await this.openSession(sessionId);
    const id = manager.appendMessage(toPiMessage(message));
    this.leafOverrides.set(sessionId, id);
    flushSessionFile(manager);
    return toSessionTreeEntry(manager.getEntry(id)!);
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
    return toSessionTreeEntry(manager.getEntry(id)!);
  }

  async appendSessionInfo(sessionId: string, name: string): Promise<ChaptaleSessionInfoEntry> {
    const manager = await this.openSession(sessionId);
    const id = manager.appendSessionInfo(name);
    this.leafOverrides.set(sessionId, id);
    flushSessionFile(manager);
    const entry = toSessionTreeEntry(manager.getEntry(id)!);

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
