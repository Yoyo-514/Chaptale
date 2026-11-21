import { CURRENT_SESSION_VERSION, SessionManager } from '@earendil-works/pi-coding-agent';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, posix, win32 } from 'node:path';

export interface OpenHostSessionManagerOptions {
  /** 应用管理的已有 JSONL；调用方负责单写者所有权。 */
  file: string;
  /** 按历史头中的会话 id 给出工作目录（已存在的绝对目录），覆盖历史头记录的目录。 */
  cwd: (sessionId: string) => Promise<string>;
}

export type HostSessionOpenErrorCode =
  | 'invalid-path'
  | 'not-found'
  | 'unreadable'
  | 'recovery-required'
  | 'unsupported-version';

const messages: Record<HostSessionOpenErrorCode, string> = {
  'invalid-path': '必须提供已有工作目录和会话文件的绝对路径',
  'not-found': '会话历史不存在，不能作为新会话打开',
  unreadable: '无法读取会话历史',
  'recovery-required': '会话历史需要恢复，原文件未被自动修复',
  'unsupported-version': '会话版本需要显式迁移，不能自动改写'
};

export class HostSessionOpenError extends Error {
  readonly code: HostSessionOpenErrorCode;

  constructor(code: HostSessionOpenErrorCode) {
    super(messages[code]);
    this.name = 'HostSessionOpenError';
    this.code = code;
  }
}

/** 返回历史头中的会话 id。 */
function inspectHistory(bytes: Uint8Array): string {
  let entries: Record<string, unknown>[];
  try {
    // 保留 BOM 供 JSON 校验拒绝；不把非法 UTF-8 静默替换成作品文本。
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    if (!text.endsWith('\n')) throw new Error('unterminated');
    entries = text
      .split('\n')
      .filter(line => line.trim())
      .map(line => {
        const value: unknown = JSON.parse(line);
        if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid entry');
        return value as Record<string, unknown>;
      });
  } catch {
    // 解析器可能回显历史内容，不能附加原始错误。
    // oxlint-disable-next-line eslint/preserve-caught-error
    throw new HostSessionOpenError('recovery-required');
  }
  const [header, ...records] = entries;
  if (!header || header.type !== 'session' || typeof header.id !== 'string' || !header.id) {
    throw new HostSessionOpenError('recovery-required');
  }
  if (header.version !== CURRENT_SESSION_VERSION) throw new HostSessionOpenError('unsupported-version');
  // 历史头保留原设备的路径；工作目录由调用方在本机重新指定。
  if (typeof header.cwd !== 'string' || !(posix.isAbsolute(header.cwd) || win32.isAbsolute(header.cwd)))
    throw new HostSessionOpenError('recovery-required');

  const ids = new Set<string>();
  for (const entry of records) {
    if (
      typeof entry.type !== 'string' ||
      !entry.type ||
      entry.type === 'session' ||
      typeof entry.id !== 'string' ||
      !entry.id ||
      ids.has(entry.id) ||
      (entry.parentId !== null && (typeof entry.parentId !== 'string' || !ids.has(entry.parentId)))
    )
      throw new HostSessionOpenError('recovery-required');
    if (entry.type === 'message') {
      const message = entry.message;
      if (!message || typeof message !== 'object' || !('role' in message) || typeof message.role !== 'string') {
        throw new HostSessionOpenError('recovery-required');
      }
    }
    ids.add(entry.id);
  }
  return header.id;
}

/** 先做无写入预检，再交给原生 SDK；不提供历史修复、版本迁移或跨进程锁。 */
export async function openHostSessionManager({ file, cwd }: OpenHostSessionManagerOptions): Promise<SessionManager> {
  if (!isAbsolute(file)) throw new HostSessionOpenError('invalid-path');
  const directory = await cwd(inspectHistory(await readHistory(file)));
  if (!isAbsolute(directory) || !(await stat(directory).catch(() => undefined))?.isDirectory()) {
    throw new HostSessionOpenError('invalid-path');
  }
  return SessionManager.open(file, undefined, directory);
}

export interface DamagedHistory {
  /** 可解析的 JSON 对象行，按文件顺序。 */
  entries: { line: number; value: Record<string, unknown> }[];
  /** 无法解码、不是 JSON 对象或未写完的行号，从 1 开始。 */
  damagedLines: number[];
}

/**
 * 只读解析预检判定需要恢复的历史，供作者查看。
 * pi 打开时会静默跳过坏行，所以这里自行逐行解码并报告位置；不修复、不写入。
 */
export async function readDamagedHistory(file: string): Promise<DamagedHistory> {
  const bytes = await readHistory(file);
  const decoder = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true });
  const result: DamagedHistory = { entries: [], damagedLines: [] };
  let start = 0;
  for (let line = 1; start < bytes.length; line++) {
    const end = bytes.indexOf(0x0a, start);
    const terminated = end !== -1;
    const segment = bytes.subarray(start, terminated ? end : bytes.length);
    start = terminated ? end + 1 : bytes.length;
    try {
      const text = decoder.decode(segment);
      if (!text.trim()) continue;
      if (!terminated) throw new Error('unterminated');
      const value: unknown = JSON.parse(text);
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid entry');
      result.entries.push({ line, value: value as Record<string, unknown> });
    } catch {
      result.damagedLines.push(line);
    }
  }
  return result;
}

async function readHistory(file: string): Promise<Uint8Array> {
  try {
    if (!(await stat(file)).isFile()) throw new HostSessionOpenError('invalid-path');
    return await readFile(file);
  } catch (error) {
    if (error instanceof HostSessionOpenError) throw error;
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    // 文件错误只暴露阶段，不附加可能携带敏感路径的原始错误。
    // oxlint-disable-next-line eslint/preserve-caught-error
    throw new HostSessionOpenError(missing ? 'not-found' : 'unreadable');
  }
}
