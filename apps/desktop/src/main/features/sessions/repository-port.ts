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

/** 会话树与文件持久化的应用层仓储端口；隐藏会话存储格式，调用方不直接依赖底层实现。 */
export interface SessionRepository {
  list(): Promise<ChaptaleSessionListItem[]>;
  create(options?: CreateSessionOptions): Promise<ChaptaleSessionMetadata>;
  /** 全量会话树（含当前分支之外的兄弟子树）；分支导航依赖同 parentId 下的多个节点。 */
  getEntries(sessionId: string): Promise<ChaptaleSessionTreeEntry[]>;
  /** 当前分支的消息投影（树上根 → leaf 的那一条）。 */
  getMessages(sessionId: string): Promise<ChatMessage[]>;
  readImage(payload: ReadSessionImagePayload): Promise<ReadSessionImageResult>;
  appendSessionInfo(sessionId: string, name: string): Promise<ChaptaleSessionInfoEntry>;
  exportHtml(sessionId: string): Promise<{ html: string; suggestedFileName: string }>;
  delete(sessionId: string): Promise<void>;
  deleteMany(sessionIds: string[]): Promise<void>;
  setLeafId(sessionId: string, targetId: string | null): Promise<void>;
  getStorageDebugInfo(): Promise<ChaptaleSessionStorageDebugInfo>;
  ensureSessionDir(): Promise<string>;
}
