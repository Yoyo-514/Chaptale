import { randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';

import type { ParsedSessionFile, SessionEntry, SessionHeader, SessionMessage, SessionMessageEntry } from './entry';
import { readSessionFile } from './reader';
import type { ContextProjection } from './replay';
import {
  buildContextMessages,
  buildContextProjection,
  getPathToRoot,
  resolveLeafId,
  resolveNaturalLeafId
} from './replay';

/** 分布式 Omit：对联合类型逐分支生效（普通 Omit 会折叠成交集）。 */
type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

type SessionEntryDraft = DistributiveOmit<SessionEntry, 'id' | 'parentId' | 'timestamp'>;

export type CreateSessionStoreOptions = {
  cwd: string;
  /** 测试注入固定 id；生产默认 randomUUID。 */
  id?: string;
  timestamp?: string;
};

/**
 * 单会话存储：append-only JSONL。
 *
 * 单会话单写者契约——实例内 append 串行（await 链），parentId 链不因并发交错断裂。
 * 写即持久（appendFile 落盘），无 flush 概念；旧事件永不物理删除。
 */
export class SessionStore {
  private constructor(
    private readonly filePath: string,
    private file: ParsedSessionFile,
    private leafId: string | null
  ) {}

  /** 写入队列：单会话单写者契约的串行化保证（append 的 parentId 计算与落盘在同一临界区）。 */
  private writeQueue: Promise<unknown> = Promise.resolve();

  static async open(filePath: string): Promise<SessionStore> {
    const file = await readSessionFile(filePath);

    return new SessionStore(filePath, file, resolveLeafId(file.entries));
  }

  static async create(filePath: string, options: CreateSessionStoreOptions): Promise<SessionStore> {
    await fs.mkdir(dirname(filePath), { recursive: true });

    const header: SessionHeader = {
      type: 'chaptale-session',
      version: 1,
      id: options.id ?? randomUUID(),
      timestamp: options.timestamp ?? new Date().toISOString(),
      cwd: options.cwd
    };

    const file: ParsedSessionFile = {
      header,
      entries: [],
      skippedMidLines: 0,
      skippedTailLines: 0
    };

    await fs.writeFile(filePath, `${JSON.stringify(header)}\n`, { flag: 'wx' });

    return new SessionStore(filePath, file, null);
  }

  /** 打开或创建（已存在则直接打开，沿用原 header）。 */
  static async openOrCreate(filePath: string, options: CreateSessionStoreOptions): Promise<SessionStore> {
    try {
      return await SessionStore.create(filePath, options);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
        return SessionStore.open(filePath);
      }

      throw error;
    }
  }

  get header(): SessionHeader {
    return this.file.header;
  }

  get currentLeafId(): string | null {
    return this.leafId;
  }

  get entries(): readonly SessionEntry[] {
    return this.file.entries;
  }

  get skippedMidLines(): number {
    return this.file.skippedMidLines;
  }

  get skippedTailLines(): number {
    return this.file.skippedTailLines;
  }

  async appendMessage(message: SessionMessage): Promise<SessionMessageEntry> {
    const entry = await this.append({ type: 'message', message });

    return entry as SessionMessageEntry;
  }

  async appendModelChange(provider: string, modelId: string): Promise<void> {
    await this.append({ type: 'model_change', provider, modelId });
  }

  async appendCompaction(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: unknown
  ): Promise<void> {
    await this.append({ type: 'compaction', summary, firstKeptEntryId, tokensBefore, details });
  }

  async appendSessionInfo(name?: string): Promise<void> {
    await this.append({ type: 'session_info', name });
  }

  async appendLabel(targetId: string, label?: string): Promise<void> {
    await this.append({ type: 'label', targetId, label });
  }

  async appendCustom(customType: string, data: unknown): Promise<void> {
    await this.append({ type: 'custom', customType, data });
  }

  /**
   * 切换 leaf 并追加 branch_selected 事件。
   * 落盘保留原始意图（null = 回到自然 leaf），leaf 解析统一在写入队列内完成；
   * 后续 append 挂在切换后的 leaf 之下，形成树上前缀共享分支。
   */
  async setLeafId(targetId: string | null): Promise<void> {
    if (targetId !== null && !this.file.entries.some(entry => entry.id === targetId)) {
      throw new Error(`Cannot branch to unknown entry: ${targetId}`);
    }

    await this.append({ type: 'branch_selected', targetId });
  }

  /** 根 → 当前 leaf（或指定 leaf）的路径。 */
  getPathToRoot(leafId?: string | null): SessionEntry[] {
    return getPathToRoot(this.file, leafId);
  }

  /** 当前生效分支的模型上下文消息（compaction 折叠后）。 */
  buildContextMessages(): SessionMessage[] {
    return buildContextMessages(this.file);
  }

  /** 同上，但保留 entry 身份——压缩需要按 entry id 定位切点。 */
  buildContextProjection(): ContextProjection {
    return buildContextProjection(this.file);
  }

  private async append(data: SessionEntryDraft): Promise<SessionEntry> {
    // 入队前只做同步校验；entry 构造必须在队列内，否则并发调用的同步段会读到同一个旧 leaf。
    const run = this.writeQueue.then(async () => {
      const entry: SessionEntry = {
        ...data,
        id: randomUUID(),
        parentId: this.leafId,
        timestamp: new Date().toISOString()
      };

      await fs.appendFile(this.filePath, `${JSON.stringify(entry)}\n`);
      this.file.entries.push(entry);

      if (entry.type === 'branch_selected') {
        // 入队内解析：targetId 保留原始意图；null 回到自然 leaf（自身入流前最后一条非 branch entry）。
        this.leafId = entry.targetId ?? resolveNaturalLeafId(this.file.entries.slice(0, -1));
      } else {
        this.leafId = entry.id;
      }

      return entry;
    });

    this.writeQueue = run.catch(() => undefined);
    return run;
  }
}

function dirname(filePath: string): string {
  const index = filePath.replace(/\\/g, '/').lastIndexOf('/');

  return index >= 0 ? filePath.slice(0, index) : '.';
}
