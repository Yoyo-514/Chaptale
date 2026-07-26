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

/** 会话树与文件持久化的应用层仓储端口；隐藏 Pi 会话格式，调用方不直接依赖 Pi。 */
export interface SessionRepository {
  list(): Promise<ChaptaleSessionListItem[]>;
  create(options?: CreateSessionOptions): Promise<ChaptaleSessionMetadata>;
  getEntries(sessionId: string): Promise<ChaptaleSessionTreeEntry[]>;
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
