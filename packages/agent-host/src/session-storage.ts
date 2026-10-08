import { CURRENT_SESSION_VERSION, SessionManager } from '@earendil-works/pi-coding-agent';
import { readFile, stat } from 'node:fs/promises';
import { isAbsolute, relative } from 'node:path';

export interface OpenHostSessionManagerOptions {
  /** 应用管理的已有 JSONL；调用方负责单写者所有权。 */
  file: string;
  /** 当前作品的已存在绝对目录，不隐式重绑定其他作品。 */
  cwd: string;
}

export type HostSessionOpenErrorCode =
  | 'invalid-path'
  | 'not-found'
  | 'unreadable'
  | 'recovery-required'
  | 'unsupported-version'
  | 'cwd-mismatch';

const messages: Record<HostSessionOpenErrorCode, string> = {
  'invalid-path': '必须提供已有工作目录和会话文件的绝对路径',
  'not-found': '会话历史不存在，不能作为新会话打开',
  unreadable: '无法读取会话历史',
  'recovery-required': '会话历史需要恢复，原文件未被自动修复',
  'unsupported-version': '会话版本需要显式迁移，不能自动改写',
  'cwd-mismatch': '会话历史不属于当前工作目录'
};

export class HostSessionOpenError extends Error {
  readonly code: HostSessionOpenErrorCode;

  constructor(code: HostSessionOpenErrorCode) {
    super(messages[code]);
    this.name = 'HostSessionOpenError';
    this.code = code;
  }
}

function inspectHistory(bytes: Uint8Array, cwd: string): void {
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
  if (typeof header.cwd !== 'string' || !isAbsolute(header.cwd)) throw new HostSessionOpenError('recovery-required');
  if (relative(cwd, header.cwd) !== '') throw new HostSessionOpenError('cwd-mismatch');

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
}

/** 先做无写入预检，再交给原生 SDK；不提供历史修复、版本迁移或跨进程锁。 */
export async function openHostSessionManager({ file, cwd }: OpenHostSessionManagerOptions): Promise<SessionManager> {
  if (!isAbsolute(file) || !isAbsolute(cwd) || !(await stat(cwd).catch(() => undefined))?.isDirectory()) {
    throw new HostSessionOpenError('invalid-path');
  }
  let bytes: Uint8Array;
  try {
    if (!(await stat(file)).isFile()) throw new HostSessionOpenError('invalid-path');
    bytes = await readFile(file);
  } catch (error) {
    if (error instanceof HostSessionOpenError) throw error;
    const missing = error instanceof Error && 'code' in error && error.code === 'ENOENT';
    // 文件错误只暴露阶段，不附加可能携带敏感路径的原始错误。
    // oxlint-disable-next-line eslint/preserve-caught-error
    throw new HostSessionOpenError(missing ? 'not-found' : 'unreadable');
  }
  inspectHistory(bytes, cwd);
  return SessionManager.open(file);
}
