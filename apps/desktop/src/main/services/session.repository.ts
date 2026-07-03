import type { ChatMessage } from '@chaptale/shared';
import type {
  ChaptaleSessionEntry,
  ChaptaleSessionListItem,
  ChaptaleSessionMetadata,
  ChaptaleSessionTreeEntry,
  CreateSessionOptions
} from '@chaptale/ipc-contract';
import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const SESSION_FILE_EXTENSION = '.jsonl';
const SESSION_HEADER_VERSION = 3;

export type JsonlSessionRepositoryOptions = {
  rootDir: string;
  cwd: string;
};

type SessionHeader = ChaptaleSessionEntry;

type ParsedSessionFile = {
  metadata: ChaptaleSessionMetadata;
  entries: ChaptaleSessionTreeEntry[];
};

function createTimestamp() {
  return new Date().toISOString();
}

function createUuidV7() {
  const bytes = randomBytes(16);
  const timestamp = BigInt(Date.now());

  bytes[0] = Number((timestamp >> 40n) & 0xffn);
  bytes[1] = Number((timestamp >> 32n) & 0xffn);
  bytes[2] = Number((timestamp >> 24n) & 0xffn);
  bytes[3] = Number((timestamp >> 16n) & 0xffn);
  bytes[4] = Number((timestamp >> 8n) & 0xffn);
  bytes[5] = Number(timestamp & 0xffn);
  bytes[6] = (bytes[6] & 0x0f) | 0x70;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function createSessionId() {
  return createUuidV7();
}

function createEntryId() {
  return createUuidV7();
}

function toSafeFileTimestamp(timestamp: string) {
  return timestamp.replaceAll(':', '-').replaceAll('.', '-');
}

function assertSessionHeader(value: unknown, filePath: string): asserts value is SessionHeader {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid session header in ${filePath}`);
  }

  const header = value as Record<string, unknown>;
  if (header.type !== 'session' || header.version !== SESSION_HEADER_VERSION) {
    throw new Error(`Unsupported session header in ${filePath}`);
  }

  if (typeof header.id !== 'string' || !header.id) {
    throw new Error(`Session header missing id in ${filePath}`);
  }

  if (typeof header.timestamp !== 'string' || !header.timestamp) {
    throw new Error(`Session header missing timestamp in ${filePath}`);
  }

  if (typeof header.cwd !== 'string' || !header.cwd) {
    throw new Error(`Session header missing cwd in ${filePath}`);
  }

  if (header.parentSession !== undefined && typeof header.parentSession !== 'string') {
    throw new Error(`Session header parentSession must be a string in ${filePath}`);
  }
}

function assertSessionTreeEntry(
  value: unknown,
  filePath: string,
  lineNumber: number
): asserts value is ChaptaleSessionTreeEntry {
  if (!value || typeof value !== 'object') {
    throw new Error(`Invalid session entry at ${filePath}:${lineNumber}`);
  }

  const entry = value as Record<string, unknown>;
  if (typeof entry.type !== 'string') {
    throw new Error(`Session entry missing type at ${filePath}:${lineNumber}`);
  }

  if (typeof entry.id !== 'string' || !entry.id) {
    throw new Error(`Session entry missing id at ${filePath}:${lineNumber}`);
  }

  if (entry.parentId !== null && typeof entry.parentId !== 'string') {
    throw new Error(`Session entry has invalid parentId at ${filePath}:${lineNumber}`);
  }

  if (typeof entry.timestamp !== 'string' || !entry.timestamp) {
    throw new Error(`Session entry missing timestamp at ${filePath}:${lineNumber}`);
  }

  if (entry.type === 'leaf' && entry.targetId !== null && typeof entry.targetId !== 'string') {
    throw new Error(`Leaf entry has invalid targetId at ${filePath}:${lineNumber}`);
  }
}

function leafIdAfterEntry(entry: ChaptaleSessionTreeEntry, currentLeafId: string | null) {
  if (entry.type === 'leaf') {
    return entry.targetId;
  }

  return entry.id || currentLeafId;
}

function toMessagePreview(message: ChatMessage) {
  if ('content' in message.payload && typeof message.payload.content === 'string') {
    return message.payload.content.slice(0, 80);
  }

  if (message.type === 'tool_call') {
    return `调用工具：${message.payload.name}`;
  }

  if (message.type === 'tool_result') {
    return `工具结果：${message.payload.name}`;
  }

  return '';
}

export class JsonlSessionRepository {
  private readonly sessionDir: string;

  constructor(private readonly options: JsonlSessionRepositoryOptions) {
    this.sessionDir = path.join(options.rootDir, 'sessions');
  }

  getStorageDebugInfo() {
    return {
      rootDir: this.options.rootDir,
      sessionDir: this.sessionDir,
      cwd: this.options.cwd
    };
  }

  async ensureSessionDir() {
    await fs.mkdir(this.sessionDir, { recursive: true });
    return this.sessionDir;
  }

  async create(options: CreateSessionOptions = {}): Promise<ChaptaleSessionMetadata> {
    await fs.mkdir(this.sessionDir, { recursive: true });

    const id = options.id ?? createSessionId();
    const timestamp = createTimestamp();
    const filePath = this.createSessionFilePath(id, timestamp);
    const header: SessionHeader = {
      type: 'session',
      version: SESSION_HEADER_VERSION,
      id,
      timestamp,
      cwd: options.cwd ?? this.options.cwd,
      parentSession: options.parentSessionPath
    };

    await fs.writeFile(filePath, `${JSON.stringify(header)}\n`, 'utf8');

    if (options.name) {
      await this.appendSessionInfo(id, options.name);
    }

    return {
      id,
      createdAt: timestamp,
      cwd: header.cwd,
      path: filePath,
      parentSessionPath: header.parentSession
    };
  }

  async ensureDefaultSession(): Promise<ChaptaleSessionMetadata> {
    const sessions = await this.list();
    return sessions[0] ?? this.create({ name: '默认会话' });
  }

  async list(): Promise<ChaptaleSessionListItem[]> {
    await fs.mkdir(this.sessionDir, { recursive: true });

    const names = await fs.readdir(this.sessionDir);
    const items = await Promise.all(
      names
        .filter(name => name.endsWith(SESSION_FILE_EXTENSION))
        .map(async name => this.toListItem(path.join(this.sessionDir, name)))
    );

    return items
      .filter((item): item is ChaptaleSessionListItem => item !== undefined)
      .toSorted((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  async getMetadata(sessionId: string): Promise<ChaptaleSessionMetadata> {
    const filePath = await this.findSessionPath(sessionId);
    return this.loadMetadata(filePath);
  }

  async getMessages(sessionId: string): Promise<ChatMessage[]> {
    const entries = await this.getPathToRoot(sessionId);
    return entries
      .filter((entry): entry is Extract<ChaptaleSessionTreeEntry, { type: 'message' }> => entry.type === 'message')
      .map(entry => entry.message);
  }

  async getEntries(sessionId: string): Promise<ChaptaleSessionTreeEntry[]> {
    const filePath = await this.findSessionPath(sessionId);
    return (await this.parseSessionFile(filePath)).entries;
  }

  async getPathToRoot(sessionId: string, leafId?: string | null): Promise<ChaptaleSessionTreeEntry[]> {
    const entries = await this.getEntries(sessionId);
    const byId = new Map(entries.map(entry => [entry.id, entry]));
    const result: ChaptaleSessionTreeEntry[] = [];
    let currentId = leafId ?? this.getLeafIdFromEntries(entries);

    while (currentId) {
      const entry = byId.get(currentId);
      if (!entry) {
        break;
      }

      result.push(entry);
      currentId = entry.parentId;
    }

    return result.toReversed();
  }

  async appendMessage(
    sessionId: string,
    message: ChatMessage
  ): Promise<Extract<ChaptaleSessionTreeEntry, { type: 'message' }>> {
    const entry: Extract<ChaptaleSessionTreeEntry, { type: 'message' }> = {
      type: 'message',
      id: createEntryId(),
      parentId: await this.getLeafId(sessionId),
      timestamp: createTimestamp(),
      message
    };

    await this.appendEntry(sessionId, entry);
    return entry;
  }

  async appendCompaction(
    sessionId: string,
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
    details?: unknown
  ): Promise<Extract<ChaptaleSessionTreeEntry, { type: 'compaction' }>> {
    const entry: Extract<ChaptaleSessionTreeEntry, { type: 'compaction' }> = {
      type: 'compaction',
      id: createEntryId(),
      parentId: await this.getLeafId(sessionId),
      timestamp: createTimestamp(),
      summary,
      firstKeptEntryId,
      tokensBefore,
      details
    };

    await this.appendEntry(sessionId, entry);
    return entry;
  }

  async appendSessionInfo(
    sessionId: string,
    name: string
  ): Promise<Extract<ChaptaleSessionTreeEntry, { type: 'session_info' }>> {
    const entry: Extract<ChaptaleSessionTreeEntry, { type: 'session_info' }> = {
      type: 'session_info',
      id: createEntryId(),
      parentId: await this.getLeafId(sessionId),
      timestamp: createTimestamp(),
      name
    };

    await this.appendEntry(sessionId, entry);
    return entry;
  }

  async setLeafId(sessionId: string, targetId: string | null): Promise<void> {
    const entry: Extract<ChaptaleSessionTreeEntry, { type: 'leaf' }> = {
      type: 'leaf',
      id: createEntryId(),
      parentId: await this.getLeafId(sessionId),
      timestamp: createTimestamp(),
      targetId
    };

    await this.appendEntry(sessionId, entry);
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = await this.findSessionPath(sessionId);
    await fs.unlink(filePath);
  }

  private async appendEntry(sessionId: string, entry: ChaptaleSessionTreeEntry) {
    const filePath = await this.findSessionPath(sessionId);
    assertSessionTreeEntry(entry, filePath, -1);
    await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, 'utf8');
  }

  private async getLeafId(sessionId: string) {
    return this.getLeafIdFromEntries(await this.getEntries(sessionId));
  }

  private getLeafIdFromEntries(entries: ChaptaleSessionTreeEntry[]) {
    return entries.reduce<string | null>((leafId, entry) => leafIdAfterEntry(entry, leafId), null);
  }

  private createSessionFilePath(id: string, timestamp: string) {
    return path.join(this.sessionDir, `${toSafeFileTimestamp(timestamp)}-${id}${SESSION_FILE_EXTENSION}`);
  }

  private async findSessionPath(sessionId: string) {
    const sessions = await this.list();
    const session = sessions.find(item => item.id === sessionId);

    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    return session.path;
  }

  private async loadMetadata(filePath: string): Promise<ChaptaleSessionMetadata> {
    const [firstLine] = (await fs.readFile(filePath, 'utf8')).split(/\r?\n/, 1);
    const parsed = JSON.parse(firstLine);
    assertSessionHeader(parsed, filePath);

    return {
      id: parsed.id,
      createdAt: parsed.timestamp,
      cwd: parsed.cwd,
      path: filePath,
      parentSessionPath: parsed.parentSession
    };
  }

  private async parseSessionFile(filePath: string): Promise<ParsedSessionFile> {
    const content = await fs.readFile(filePath, 'utf8');
    const lines = content.split(/\r?\n/).filter(line => line.trim().length > 0);
    const [headerLine, ...entryLines] = lines;

    if (!headerLine) {
      throw new Error(`Session file missing header: ${filePath}`);
    }

    const header = JSON.parse(headerLine);
    assertSessionHeader(header, filePath);

    const entries = entryLines.map((line, index) => {
      const parsed = JSON.parse(line);
      assertSessionTreeEntry(parsed, filePath, index + 2);
      return parsed;
    });

    return {
      metadata: {
        id: header.id,
        createdAt: header.timestamp,
        cwd: header.cwd,
        path: filePath,
        parentSessionPath: header.parentSession
      },
      entries
    };
  }

  private async toListItem(filePath: string): Promise<ChaptaleSessionListItem | undefined> {
    try {
      const parsed = await this.parseSessionFile(filePath);
      const sessionInfoEntries = parsed.entries.filter(
        (entry): entry is Extract<ChaptaleSessionTreeEntry, { type: 'session_info' }> => entry.type === 'session_info'
      );
      const messageEntries = parsed.entries.filter(
        (entry): entry is Extract<ChaptaleSessionTreeEntry, { type: 'message' }> => entry.type === 'message'
      );
      const lastEntry = parsed.entries.at(-1);
      const lastMessage = messageEntries.at(-1)?.message;

      return {
        ...parsed.metadata,
        name: sessionInfoEntries.at(-1)?.name,
        updatedAt: lastEntry?.timestamp ?? parsed.metadata.createdAt,
        leafId: this.getLeafIdFromEntries(parsed.entries),
        messageCount: messageEntries.length,
        lastMessagePreview: lastMessage ? toMessagePreview(lastMessage) : undefined
      };
    } catch (error) {
      console.warn(`Skip invalid session file ${filePath}:`, error);
      return undefined;
    }
  }
}
