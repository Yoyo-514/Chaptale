import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

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
import type { ChatImageAttachment, ChatMessage, ChatTextPart } from '@chaptale/shared';

import type { ImageAttachmentService } from '../../core/attachments/service';
import { decodeUserMessage } from '../../core/prompt-envelope/decode-user-message';
import type { SessionEntry, SessionMessage } from '../../core/sessions/entry';
import { parseSessionContent } from '../../core/sessions/reader';
import type { SessionStorageContext } from '../../core/sessions/storage';
import { SessionStorageResolver } from '../../core/sessions/storage';
import { SessionStore } from '../../core/sessions/store';
import type { SessionStoreProvider } from '../../core/sessions/store-provider-port';
import { deriveSessionSummary } from '../../core/sessions/summary';
import { buildSessionHtml } from './html-renderer';
import type { SessionRepository } from './repository-port';

export type SessionRepositoryOptions = {
  rootDir: string;
  cwd: string | (() => string | Promise<string>);
  sessionDir: string | (() => string | Promise<string>);
  sessionsRootDir?: string | (() => string | Promise<string>);
  getStorageContext?: () => SessionStorageContext | Promise<SessionStorageContext>;
  /** 图片附件呈现端口（缩略图/尺寸）与 context-file 原图读取。 */
  imageAttachmentService?: ImageAttachmentService;
};

/**
 * 自有会话仓储：append-only store 之上实现应用层 SessionRepository 端口。
 *
 * 契约即 OpenAI Chat Messages 形状：store / engine / UI 同形状贯通，
 * 本层仅做两处呈现级转换——user 图片 → 轻量附件（缩略图）；entry 类型枚举对齐。
 * 同时实现 core 的 SessionStoreProvider：运行时只经那个窄端口取 store，不认识本类。
 */
export class JsonlSessionRepository implements SessionRepository, SessionStoreProvider {
  private readonly storage: SessionStorageResolver;
  private readonly stores = new Map<string, SessionStore>();

  constructor(private readonly options: SessionRepositoryOptions) {
    this.storage = new SessionStorageResolver(options);
  }

  async list(): Promise<ChaptaleSessionListItem[]> {
    const dirs = await this.storage.getKnownSessionDirs();
    const items: ChaptaleSessionListItem[] = [];

    for (const dir of dirs) {
      let files: string[] = [];

      try {
        files = (await fs.readdir(dir)).filter(name => name.endsWith('.jsonl'));
      } catch {
        continue;
      }

      for (const file of files) {
        const filePath = path.join(dir, file);

        try {
          const parsed = parseSessionContent(await fs.readFile(filePath, 'utf8'));
          items.push(deriveSessionSummary(parsed, dir, filePath));
        } catch {
          // 非会话文件（缺 header/坏文件）：列表静默跳过，具体错误留给打开操作。
        }
      }
    }

    return items.toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async create(options?: CreateSessionOptions): Promise<ChaptaleSessionMetadata> {
    const sessionDir = await this.storage.ensureSessionDir();
    const cwd = options?.cwd ?? (await this.storage.resolveCwd());
    const id = options?.id ?? randomUUID();
    const filePath = path.join(sessionDir, `${id}.jsonl`);

    const store = await SessionStore.create(filePath, { cwd, id });
    this.stores.set(id, store);

    if (options?.name) {
      await store.appendSessionInfo(options.name);
    }

    return {
      id,
      createdAt: store.header.timestamp,
      cwd,
      path: filePath,
      ...(options?.parentSessionPath ? { parentSessionPath: options.parentSessionPath } : {})
    };
  }

  /**
   * 会话树全量节点（含当前分支之外的兄弟子树）。
   *
   * 必须是全量：UI 靠"同 parentId 下有几个 user 节点"判断该不该显示分支导航，
   * 只给当前分支时每层恒为一个节点，导航就永远不出现。
   * 当前分支的投影由调用方沿 parentId 自行回溯（leaf 见 `list()` 的 leafId）。
   */
  async getEntries(sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const store = await this.open(sessionId);

    return this.toTreeEntries(store.entries, sessionId);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const store = await this.open(sessionId);
    const messages: ChatMessage[] = [];

    for (const entry of store.getPathToRoot()) {
      if (entry.type !== 'message') {
        continue;
      }

      const mapped = await this.toUiMessage(entry.message, {
        sessionId,
        entryId: entry.id,
        imageAttachmentService: this.options.imageAttachmentService
      });

      if (mapped) {
        mapped.timestamp = Date.parse(entry.timestamp);
        messages.push(mapped);
      }
    }

    return messages;
  }

  async readImage(payload: ReadSessionImagePayload): Promise<ReadSessionImageResult> {
    if (payload.type === 'context-file') {
      if (!this.options.imageAttachmentService) {
        throw new Error('context-file 图片读取未装配附件服务');
      }

      return this.options.imageAttachmentService.readContextFile(payload.path);
    }

    const store = await this.open(payload.sessionId);
    const entry = store.entries.find(item => item.id === payload.entryId);

    if (!entry || entry.type !== 'message' || entry.message.role !== 'user') {
      throw new Error('找不到图片所属的会话消息');
    }

    const content = entry.message.content;

    if (typeof content === 'string') {
      throw new Error('该消息不包含图片');
    }

    // blockIndex 语义 = 原始 content 下标（与写入时一致），跳过非图片位。
    const target = content[payload.blockIndex];

    if (!target || target.type !== 'image') {
      throw new Error('图片不存在');
    }

    return {
      data: new Uint8Array(Buffer.from(target.data, 'base64')),
      mimeType: target.mimeType
    };
  }

  async appendSessionInfo(sessionId: string, name: string): Promise<ChaptaleSessionInfoEntry> {
    const store = await this.open(sessionId);
    await store.appendSessionInfo(name);

    const entry = store.entries.at(-1);

    if (!entry || entry.type !== 'session_info') {
      throw new Error('session_info 落盘失败');
    }

    return {
      type: 'session_info',
      id: entry.id,
      parentId: entry.parentId,
      timestamp: entry.timestamp,
      name: entry.name
    };
  }

  async exportHtml(sessionId: string): Promise<{ html: string; suggestedFileName: string }> {
    const store = await this.open(sessionId);
    // 导出的是作者当前看到的这条线，不是整棵树：被切走的分支不该出现在成稿里。
    const entries = await this.toTreeEntries(store.getPathToRoot(), sessionId);
    const name = findSessionName(store) ?? '未命名会话';

    return {
      html: buildSessionHtml({ name, entries }),
      suggestedFileName: `${toSafeFileName(name)}.html`
    };
  }

  async delete(sessionId: string): Promise<void> {
    this.stores.delete(sessionId);
    await this.storage.deleteSessionFile(await this.locateSessionFile(sessionId));
  }

  async deleteMany(sessionIds: string[]): Promise<void> {
    for (const sessionId of sessionIds) {
      await this.delete(sessionId);
    }
  }

  async setLeafId(sessionId: string, targetId: string | null): Promise<void> {
    const store = await this.open(sessionId);
    await store.setLeafId(targetId);
  }

  async getStorageDebugInfo(): Promise<ChaptaleSessionStorageDebugInfo> {
    const context = await this.storage.getStorageContext();

    return {
      rootDir: this.storage.rootDir,
      sessionDir: await this.storage.resolveSessionDir(),
      cwd: await this.storage.resolveCwd(),
      ...(context.storageMode ? { storageMode: context.storageMode } : {}),
      ...(context.workspacePath ? { workspacePath: context.workspacePath } : {})
    };
  }

  async ensureSessionDir(): Promise<string> {
    return this.storage.ensureSessionDir();
  }

  /** 打开（带缓存的）会话 store。 */
  /** 打开（带缓存的）会话 store：先查当前目录，再扫 sessions 根下全部已知目录（跨 global/workspace）。 */
  async open(sessionId: string): Promise<SessionStore> {
    const cached = this.stores.get(sessionId);

    if (cached) {
      return cached;
    }

    const filePath = await this.locateSessionFile(sessionId);
    const store = await SessionStore.open(filePath);
    this.stores.set(sessionId, store);

    return store;
  }

  /** 会话文件定位：列表来自多个 scope 目录，打开时按 sessionId 全域查找。 */
  private async locateSessionFile(sessionId: string): Promise<string> {
    const dirs = await this.storage.getKnownSessionDirs();

    for (const dir of dirs) {
      const candidate = path.join(dir, `${sessionId}.jsonl`);

      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // 继续下一目录。
      }
    }

    // 都未命中时返回默认路径，让 SessionStore.open 抛出可读错误。
    return path.join(dirs[0] ?? (await this.storage.resolveSessionDir()), `${sessionId}.jsonl`);
  }

  /** 打开或创建（AgentService 首轮对话前调用）。 */
  async openOrCreate(sessionId: string, cwd?: string): Promise<SessionStore> {
    const cached = this.stores.get(sessionId);

    if (cached) {
      return cached;
    }

    const sessionDir = await this.storage.ensureSessionDir();
    const store = await SessionStore.openOrCreate(path.join(sessionDir, `${sessionId}.jsonl`), {
      // id 必须显式传：会话按文件名定位（locateSessionFile / delete 都拼 `${id}.jsonl`），
      // 而 list() 报的是 header.id。缺省会让 header 落一个随机 UUID，
      // 于是这个会话在历史里列得出来、点开却找不到文件。
      id: sessionId,
      cwd: cwd ?? (await this.storage.resolveCwd())
    });
    this.stores.set(sessionId, store);

    return store;
  }

  /** 会话 cwd（已落盘则读 header，否则当前工作区）。 */
  async resolveSessionCwd(sessionId: string): Promise<string> {
    try {
      const store = await this.open(sessionId);
      return store.header.cwd;
    } catch {
      return this.storage.resolveCwd();
    }
  }

  /** store entry 列表 → 树 entry 列表；不可展示的节点（system 消息）整条丢弃。 */
  private async toTreeEntries(source: readonly SessionEntry[], sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const entries: ChaptaleSessionTreeEntry[] = [];

    for (const entry of source) {
      const mapped = await this.toTreeEntry(entry, sessionId);

      if (mapped) {
        entries.push(mapped);
      }
    }

    return entries;
  }

  /** store entry → 树 entry（类型枚举对齐 + user 图片附件化；无跨形状翻译）。 */
  private async toTreeEntry(entry: SessionEntry, sessionId: string): Promise<ChaptaleSessionTreeEntry | null> {
    const base = { id: entry.id, parentId: entry.parentId, timestamp: entry.timestamp };

    switch (entry.type) {
      case 'message': {
        const message = await this.toUiMessage(entry.message, {
          sessionId,
          entryId: entry.id,
          imageAttachmentService: this.options.imageAttachmentService
        });

        if (!message) {
          return null;
        }

        return { type: 'message', ...base, message };
      }

      case 'compaction':
        return {
          type: 'compaction',
          ...base,
          summary: entry.summary,
          firstKeptEntryId: entry.firstKeptEntryId,
          tokensBefore: entry.tokensBefore,
          ...(entry.details !== undefined ? { details: entry.details } : {})
        };

      case 'session_info':
        return {
          type: 'session_info',
          ...base,
          ...(entry.name !== undefined ? { name: entry.name } : {})
        };

      case 'label':
        return {
          type: 'label',
          ...base,
          targetId: entry.targetId,
          ...(entry.label !== undefined ? { label: entry.label } : {})
        };

      case 'model_change':
        return {
          type: 'custom',
          ...base,
          name: 'model_change',
          data: { provider: entry.provider, modelId: entry.modelId }
        };

      case 'branch_selected':
        return { type: 'custom', ...base, name: 'branch_selected', data: { targetId: entry.targetId } };

      case 'custom':
        return { type: 'custom', ...base, name: entry.customType, data: entry.data };
    }
  }

  /** SessionMessage → ChatMessage：形状同源直通；仅 user 图片经附件端口转轻量附件。 */
  private async toUiMessage(
    message: SessionMessage,
    options: { sessionId: string; entryId: string; imageAttachmentService?: ImageAttachmentService }
  ): Promise<ChatMessage | null> {
    switch (message.role) {
      case 'system':
        return null;

      case 'user': {
        // 落盘内容含 memory/context/skill 信封（只服务模型）；UI、历史与导出一律只看作者原文。
        // 信封只出现在首个文本块上（写入形态固定为 [text, ...images]）。
        const firstText =
          typeof message.content === 'string'
            ? message.content
            : (message.content.find(part => part.type === 'text')?.text ?? '');
        const decoded = decodeUserMessage(firstText);
        // 老会话可能没有随行 contextFiles 元数据，此时回落到信封里恢复出的那份。
        const contextFiles =
          message.contextFiles ?? (decoded.contextFiles.length > 0 ? decoded.contextFiles : undefined);
        const common = {
          ...(contextFiles ? { contextFiles } : {}),
          ...(decoded.skillInvocation ? { skillInvocation: decoded.skillInvocation } : {}),
          timestamp: 0
        };

        if (typeof message.content === 'string') {
          return { role: 'user', content: decoded.text, ...common };
        }

        const parts: Array<ChatTextPart | ChatImageAttachment> = [];
        let textSeen = false;

        for (const [index, part] of message.content.entries()) {
          if (part.type === 'text') {
            parts.push({ type: 'text', text: textSeen ? part.text : decoded.text });
            textSeen = true;
          } else if (options.imageAttachmentService) {
            const presented = options.imageAttachmentService.createPresentation(
              [{ type: 'image', data: part.data, mimeType: part.mimeType, blockIndex: index }],
              () => ({
                type: 'session-entry',
                sessionId: options.sessionId,
                entryId: options.entryId,
                blockIndex: index
              })
            );

            parts.push(...presented.attachments);
          }
        }

        return { role: 'user', content: parts, ...common };
      }

      case 'assistant': {
        // store 的 assistant parts 仅含文本（图片只在 user 消息）；toolCalls 同形直通。
        const textParts =
          typeof message.content === 'string'
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .filter((part): part is { type: 'text'; text: string } => part.type === 'text')
                  .map(part => ({ type: 'text' as const, text: part.text }))
              : undefined;

        return {
          role: 'assistant',
          ...(textParts !== undefined && textParts !== '' ? { content: textParts } : {}),
          ...(message.reasoning ? { reasoning: message.reasoning } : {}),
          ...(message.toolCalls && message.toolCalls.length > 0 ? { toolCalls: message.toolCalls } : {}),
          ...(message.usage
            ? {
                usage: {
                  inputTokens: message.usage.inputTokens,
                  outputTokens: message.usage.outputTokens,
                  totalTokens: message.usage.totalTokens
                }
              }
            : {}),
          timestamp: 0
        };
      }

      case 'tool':
        return {
          role: 'tool',
          toolCallId: message.toolCallId,
          toolName: message.toolName,
          output: message.output,
          // 失败标记透传：不带它，历史回放里工具卡片的失败态不可达。
          ...(message.isError === true ? { isError: true } : {}),
          timestamp: 0
        };
    }
  }
}

function findSessionName(store: SessionStore): string | undefined {
  for (let index = store.entries.length - 1; index >= 0; index -= 1) {
    const entry = store.entries[index];

    if (entry.type === 'session_info' && entry.name) {
      return entry.name;
    }
  }

  return undefined;
}

function toSafeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|\s]+/g, '-').slice(0, 80) || 'session';
}
