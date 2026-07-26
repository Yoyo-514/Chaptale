import { SessionManager } from '@earendil-works/pi-coding-agent';
import path from 'node:path';
import { unique } from 'radash';

import type {
  ChaptaleSessionInfoEntry,
  ChaptaleSessionListItem,
  ChaptaleSessionMetadata,
  ChaptaleSessionStorageDebugInfo,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions,
  ReadSessionImagePayload,
  ReadSessionImageResult
} from '@chaptale/ipc-contract';
import type { ChatMessage } from '@chaptale/shared';

import type { ImageAttachmentService } from '../../../core/attachments/service';
import { buildSessionHtml, toSafeFileName } from '../../../modules/sessions/html-renderer';
import type { SessionRepository } from '../../../modules/sessions/repository';
import { toSessionListItem, toSessionTreeEntry } from './entry-mapper';
import { flushSessionFile } from './file';
import { fromPiMessage, toPiMessage } from './message-mapper';
import { getSessionScope, SessionStorageResolver, type SessionStorageOptions } from './storage';
import { readSessionUsage } from './usage';
import { getPiUserImageBlocks } from './user-image-blocks';

export type PiSessionRepositoryOptions = SessionStorageOptions;

/** 会话 CRUD、分支/leaf 与消息读取；路径解析与文件删除委托给 SessionStorageResolver。 */
export class PiSessionRepository implements SessionRepository {
  // SessionManager 每次打开文件都会恢复持久化叶子；内存覆盖记录用户本次选择，确保后续读取沿用刚切换的分支。
  private readonly leafOverrides = new Map<string, string | null>();
  private readonly storage: SessionStorageResolver;

  constructor(
    options: PiSessionRepositoryOptions,
    private readonly imageAttachmentService: ImageAttachmentService,
    storage = new SessionStorageResolver(options)
  ) {
    this.storage = storage;
  }

  async getStorageDebugInfo(): Promise<ChaptaleSessionStorageDebugInfo> {
    const context = await this.storage.getStorageContext();

    return {
      rootDir: this.storage.rootDir,
      sessionDir: await this.storage.resolveSessionDir(),
      cwd: await this.storage.resolveCwd(),
      storageMode: context.storageMode,
      workspacePath: context.workspacePath
    };
  }

  async ensureSessionDir() {
    return this.storage.ensureSessionDir();
  }

  async create(options: CreateSessionOptions = {}): Promise<ChaptaleSessionMetadata> {
    const cwd = options.cwd ?? (await this.storage.resolveCwd());
    const sessionDir = await this.storage.ensureSessionDir();
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

  /** 聚合 global 与所有 workspace 目录中的会话，并按最后修改时间统一排序。 */
  async list(): Promise<ChaptaleSessionListItem[]> {
    const sessionDirs = await this.storage.getKnownSessionDirs();
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

  /** 导出当前分支为单文件 HTML；文件写入由 modules/sessions/export 负责。 */
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

    return this.imageAttachmentService.readOriginal(getPiUserImageBlocks(entry.message), payload.blockIndex);
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

  /**
   * 切换当前进程中的会话叶子；null 回到根分支。
   * 覆盖值由仓储保存并在每次重新打开 SessionManager 时重放，避免后续读取退回旧叶子。
   */
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
    await this.storage.deleteSessionFile(session.path);
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

      await this.storage.deleteSessionFile(session.path);
    }
  }

  private async openSession(sessionId: string) {
    const [session, fallbackCwd] = await Promise.all([this.findSessionInfo(sessionId), this.storage.resolveCwd()]);
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
}
