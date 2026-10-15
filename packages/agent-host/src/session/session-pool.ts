import {
  type AgentSession,
  type CreateAgentSessionResult,
  type ModelRuntime,
  SessionManager
} from '@earendil-works/pi-coding-agent';
import { realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, sep } from 'node:path';

import { openHostSessionManager } from './session-storage.ts';
import { createHostSession, type CreateHostSessionOptions } from './session.ts';

export interface CreateHostSessionPoolOptions {
  agentDir: string;
  /** 应用私有的已有目录；所有会话文件只在此目录创建或打开。 */
  sessionDir: string;
  modelRuntime: ModelRuntime;
}

export type HostSessionInput = Omit<CreateHostSessionOptions, 'agentDir' | 'sessionManager' | 'modelRuntime'>;

export interface HostSessionSummary {
  id: string;
  cwd: string;
  /** 原生目标文件路径；空会话在首条 user/assistant 消息前尚未创建文件。 */
  file: string;
  status: 'idle' | 'running' | 'closing';
}

type OwnedSession = { result: CreateAgentSessionResult; file: string };

// 同一进程误装配第二个池时，也不能为同一文件创建另一位写者。
const fileOwners = new Map<string, HostSessionPool>();

async function directory(value: string): Promise<string> {
  if (!isAbsolute(value) || !(await stat(value)).isDirectory()) {
    throw new Error('会话池目录必须是已存在的绝对目录');
  }
  return realpath(value);
}

/**
 * 后端进程拥有的原生会话集合，不绑定窗口或 Activity。
 * 仅协调单进程内的创建、打开和关闭；prompt/steer/模型/事件仍使用原生 AgentSession。
 */
export class HostSessionPool {
  private readonly options: CreateHostSessionPoolOptions;
  private readonly sessions = new Map<string, OwnedSession>();
  private readonly ids = new Set<string>();
  private readonly pending = new Set<Promise<unknown>>();
  private readonly closing = new Map<string, Promise<void>>();
  private stopping = false;
  private disposal?: Promise<void>;

  private constructor(options: CreateHostSessionPoolOptions) {
    this.options = options;
  }

  static async create(options: CreateHostSessionPoolOptions): Promise<HostSessionPool> {
    return new HostSessionPool({
      ...options,
      agentDir: await directory(options.agentDir),
      sessionDir: await directory(options.sessionDir)
    });
  }

  createSession(input: HostSessionInput): Promise<CreateAgentSessionResult> {
    return this.start(async () => {
      const manager = SessionManager.create(input.cwd, this.options.sessionDir);
      const file = manager.getSessionFile();
      if (!file) throw new Error('原生持久会话未分配文件');
      this.claimFile(file);
      return this.attach(manager, file, input);
    });
  }

  openSession(input: HostSessionInput & { file: string }): Promise<CreateAgentSessionResult> {
    // prepare 始终返回装配参数，结果不会是 undefined。
    return this.openWith(input, () => input) as Promise<CreateAgentSessionResult>;
  }

  /**
   * 先占有文件再读取历史，由 prepare 根据已读内容给出装配参数；JSONL 只读一次。
   * prepare 返回 undefined 时不创建会话并释放文件。
   */
  openWith(
    { file, cwd }: { file: string; cwd: string },
    prepare: (manager: SessionManager) => HostSessionInput | undefined
  ): Promise<CreateAgentSessionResult | undefined> {
    return this.start(async () => {
      if (!isAbsolute(file)) throw new Error('会话文件必须是绝对路径');
      const real = await realpath(file);
      const inside = relative(this.options.sessionDir, real);
      if (!inside || inside === '..' || inside.startsWith('..' + sep) || isAbsolute(inside)) {
        throw new Error('会话文件必须位于会话池目录内');
      }
      // 先占有文件再预检，阻止本进程第二次打开尚在装配或写入的历史。
      this.claimFile(real);
      let manager: SessionManager;
      let input: HostSessionInput | undefined;
      try {
        manager = await openHostSessionManager({ file: real, cwd });
        input = prepare(manager);
      } catch (error) {
        this.releaseFile(real);
        throw error;
      }
      if (!input) {
        this.releaseFile(real);
        return undefined;
      }
      return this.attach(manager, real, input);
    });
  }

  /** UI 重连只取已有会话，不新建执行者；关闭中的会话不可重新取得。 */
  get(id: string): AgentSession | undefined {
    return this.stopping || this.closing.has(id) ? undefined : this.sessions.get(id)?.result.session;
  }

  list(): HostSessionSummary[] {
    return [...this.sessions].map(
      ([
        id,
        {
          result: { session },
          file
        }
      ]) => ({
        id,
        cwd: session.sessionManager.getCwd(),
        file,
        status: this.closing.has(id)
          ? 'closing'
          : session.isStreaming || session.isCompacting || session.isRetrying
            ? 'running'
            : 'idle'
      })
    );
  }

  close(id: string): Promise<void> {
    const existing = this.closing.get(id);
    if (existing) return existing;
    const owned = this.sessions.get(id);
    if (!owned) return Promise.resolve();
    const operation = Promise.resolve().then(async () => {
      try {
        await owned.result.session.abort();
      } finally {
        try {
          owned.result.session.dispose();
        } finally {
          this.sessions.delete(id);
          this.ids.delete(id);
          this.releaseFile(owned.file);
          this.closing.delete(id);
        }
      }
    });
    this.closing.set(id, operation);
    return operation;
  }

  /** 不删除 JSONL；先等待已接收的装配结束，再取消并释放所有会话。 */
  dispose(): Promise<void> {
    if (this.disposal) return this.disposal;
    this.stopping = true;
    this.disposal = (async () => {
      await Promise.allSettled(this.pending);
      const results = await Promise.allSettled([...this.sessions.keys()].map(id => this.close(id)));
      const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
      if (errors.length) throw new AggregateError(errors, '部分会话未能正常关闭');
    })();
    return this.disposal;
  }

  private start<T>(create: () => Promise<T>): Promise<T> {
    if (this.stopping) return Promise.reject(new Error('会话池正在关闭或已经关闭'));
    const operation = create();
    this.pending.add(operation);
    void operation.then(
      () => this.pending.delete(operation),
      () => this.pending.delete(operation)
    );
    return operation;
  }

  private claimFile(file: string): void {
    if (fileOwners.has(file)) throw new Error('该会话文件已由本进程会话池持有，请取得已有会话');
    fileOwners.set(file, this);
  }

  private releaseFile(file: string): void {
    if (fileOwners.get(file) === this) fileOwners.delete(file);
  }

  private async attach(
    manager: SessionManager,
    file: string,
    input: HostSessionInput
  ): Promise<CreateAgentSessionResult> {
    const id = manager.getSessionId();
    if (this.ids.has(id)) {
      this.releaseFile(file);
      throw new Error('会话 ID 已由本会话池持有，不能同时打开历史副本');
    }
    this.ids.add(id);
    try {
      const result = await createHostSession({
        ...input,
        agentDir: this.options.agentDir,
        modelRuntime: this.options.modelRuntime,
        sessionManager: manager
      });
      this.sessions.set(id, { result, file });
      return result;
    } catch (error) {
      this.ids.delete(id);
      this.releaseFile(file);
      throw error;
    }
  }
}
