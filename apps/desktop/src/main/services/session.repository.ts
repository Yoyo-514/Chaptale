import type {
  ChaptaleSessionInfoEntry,
  ChaptaleSessionListItem,
  ChaptaleSessionMetadata,
  ChaptaleSessionScope,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions,
  ReadSessionImagePayload,
  ReadSessionImageResult
} from '@chaptale/ipc-contract';
import type { ChatMessage } from '@chaptale/shared';
import { SessionManager } from '@earendil-works/pi-coding-agent';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { unique } from 'radash';

import { toSessionListItem, toSessionTreeEntry } from '../sessions/pi-session-entry.mapper';
import { ImageAttachmentService } from './image-attachment.service';
import { flushSessionFile } from '../sessions/pi-session-file';
import { fromPiMessage, toPiMessage } from '../sessions/pi-session-message.mapper';
import { buildSessionHtml, toSafeFileName } from '../sessions/session-html';
import { readSessionUsage } from '../sessions/pi-session-usage';

export type PiSessionRepositoryOptions = {
  rootDir: string;
  cwd: string | (() => string | Promise<string>);
  sessionDir: string | (() => string | Promise<string>);
  sessionsRootDir?: string | (() => string | Promise<string>);
  getStorageContext?: () =>
    | { storageMode?: 'global' | 'workspace'; workspacePath?: string }
    | Promise<{ storageMode?: 'global' | 'workspace'; workspacePath?: string }>;
};

export class PiSessionRepository {
  private readonly leafOverrides = new Map<string, string | null>();

  constructor(
    private readonly options: PiSessionRepositoryOptions,
    private readonly imageAttachmentService = new ImageAttachmentService()
  ) {}

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
    return sessions[0] ?? this.create({ name: '新会话' });
  }

  async list(): Promise<ChaptaleSessionListItem[]> {
    const sessionDirs = await this.getKnownSessionDirs();
    const sessions = await Promise.all(
      sessionDirs.map(async sessionDir => {
        const scope = getSessionScope(sessionDir);
        const items = await SessionManager.listAll(sessionDir);
        return Promise.all(
          items.map(async info => {
            const usage = await readSessionUsage(info.path, info.modified.getTime());
            return toSessionListItem(info, { scope, ...usage });
          })
        );
      })
    );

    return sessions.flat().toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getMetadata(sessionId: string): Promise<ChaptaleSessionMetadata> {
    const manager = await this.openSession(sessionId);
    return this.getMetadataFromManager(manager);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const manager = await this.openSession(sessionId);
    return manager
      .buildSessionContext()
      .messages.map(message =>
        fromPiMessage(message, {
          // buildSessionContext 拿不到 entryId，无法构造 session-entry source；
          // 前端在缺 source 时会退化为直接展示缩略图。UI 主链路走 getEntries（带 source）。
          presentUserImages: images => this.imageAttachmentService.createPresentation(images)
        })
      )
      .filter((message): message is ChatMessage => message !== undefined);
  }

  async getEntries(sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const manager = await this.openSession(sessionId);
    return manager
      .getEntries()
      .map(entry => toSessionTreeEntry(entry, { sessionId, imageAttachmentService: this.imageAttachmentService }));
  }

  async getPathToRoot(sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const manager = await this.openSession(sessionId);
    return manager
      .getBranch()
      .map(entry => toSessionTreeEntry(entry, { sessionId, imageAttachmentService: this.imageAttachmentService }));
  }

  /** 导出当前分支为单文件 HTML；文件写入由 IPC 层负责。 */
  async exportHtml(sessionId: string): Promise<{ html: string; suggestedFileName: string }> {
    const [session, entries] = await Promise.all([this.findSessionInfo(sessionId), this.getPathToRoot(sessionId)]);
    const name = session.name || session.lastMessagePreview || '未命名会话';

    return {
      html: buildSessionHtml({ name, entries }),
      suggestedFileName: `${toSafeFileName(name)}.html`
    };
  }

  async readImage(payload: ReadSessionImagePayload): Promise<ReadSessionImageResult> {
    if (payload.type === 'context-file') {
      return this.imageAttachmentService.readContextFile(payload.path);
    }

    const manager = await this.openSession(payload.sessionId);
    const entry = manager.getEntry(payload.entryId);

    if (!entry || entry.type !== 'message') {
      throw new Error('找不到图片所属的会话消息');
    }

    return this.imageAttachmentService.readOriginal(entry.message, payload.blockIndex);
  }

  async appendMessage(sessionId: string, message: ChatMessage) {
    const manager = await this.openSession(sessionId);
    const id = manager.appendMessage(toPiMessage(message));
    this.leafOverrides.set(sessionId, id);
    flushSessionFile(manager);
    return toSessionTreeEntry(manager.getEntry(id)!, {
      sessionId,
      imageAttachmentService: this.imageAttachmentService
    });
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
    return toSessionTreeEntry(manager.getEntry(id)!, {
      sessionId,
      imageAttachmentService: this.imageAttachmentService
    });
  }

  async appendSessionInfo(sessionId: string, name: string): Promise<ChaptaleSessionInfoEntry> {
    const manager = await this.openSession(sessionId);
    const id = manager.appendSessionInfo(name);
    this.leafOverrides.set(sessionId, id);
    flushSessionFile(manager);
    const entry = toSessionTreeEntry(manager.getEntry(id)!, {
      sessionId,
      imageAttachmentService: this.imageAttachmentService
    });

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
    await this.deleteSessionFile(session);
  }

  async deleteMany(sessionIds: string[]): Promise<void> {
    const uniqueSessionIds = unique(sessionIds);

    if (uniqueSessionIds.length === 0) {
      return;
    }

    const sessions = await this.list();
    const sessionMap = new Map(sessions.map(session => [session.id, session]));

    for (const sessionId of uniqueSessionIds) {
      const session = sessionMap.get(sessionId);

      if (!session) {
        throw new Error(`Session not found: ${sessionId}`);
      }

      await this.deleteSessionFile(session);
    }
  }

  private async openSession(sessionId: string) {
    const [session, fallbackCwd] = await Promise.all([this.findSessionInfo(sessionId), this.resolveCwd()]);
    const sessionDir = path.dirname(session.path);
    const manager = SessionManager.open(session.path, sessionDir, session.cwd || fallbackCwd);
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

  private async deleteSessionFile(session: ChaptaleSessionListItem) {
    const sessionsRootDir = await this.resolveSessionsRootDir();
    const resolvedSessionPath = path.resolve(session.path);
    const resolvedSessionsRootDir = path.resolve(sessionsRootDir);

    if (!resolvedSessionPath.startsWith(`${resolvedSessionsRootDir}${path.sep}`)) {
      throw new Error(`Refuse to delete session outside sessions root directory: ${session.path}`);
    }

    await fs.unlink(resolvedSessionPath);
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

  private async getKnownSessionDirs() {
    const [currentSessionDir, sessionsRootDir] = await Promise.all([
      this.ensureSessionDir(),
      this.resolveSessionsRootDir()
    ]);
    await fs.mkdir(sessionsRootDir, { recursive: true });

    const entries = await fs.readdir(sessionsRootDir, { withFileTypes: true });
    const dirs = entries.filter(entry => entry.isDirectory()).map(entry => path.join(sessionsRootDir, entry.name));

    return unique([currentSessionDir, ...dirs]);
  }

  private async resolveSessionsRootDir() {
    if (this.options.sessionsRootDir) {
      return typeof this.options.sessionsRootDir === 'function'
        ? await this.options.sessionsRootDir()
        : this.options.sessionsRootDir;
    }

    return path.dirname(await this.resolveSessionDir());
  }

  private async resolveSessionDir() {
    return typeof this.options.sessionDir === 'function' ? await this.options.sessionDir() : this.options.sessionDir;
  }

  private async resolveCwd() {
    return typeof this.options.cwd === 'function' ? await this.options.cwd() : this.options.cwd;
  }
}

function getSessionScope(sessionDir: string): ChaptaleSessionScope {
  return path.basename(sessionDir) === 'global' ? 'global' : 'workspace';
}
