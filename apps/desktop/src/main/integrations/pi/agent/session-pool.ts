export type DisposableSession = {
  dispose(): void | Promise<void>;
};

/**
 * 按 key 复用会话的创建 Promise。
 *
 * 并发请求同一 key 共享同一次创建，避免为同一持久化文件构造多个上游会话；
 * 创建失败的条目会被逐出，使下一次 get 可以重试初始化。
 */
export class SessionPool<TSession extends DisposableSession> {
  private readonly entries = new Map<string, Promise<TSession>>();

  constructor(private readonly create: (key: string) => Promise<TSession>) {}

  get(key: string): Promise<TSession> {
    const cached = this.entries.get(key);

    if (cached) {
      return cached;
    }

    const created = this.create(key);
    this.entries.set(key, created);
    // 只有当前条目仍是本次创建时才逐出：invalidate 后重新 get 的新条目不能被旧 rejection 误删。
    created.catch(() => {
      if (this.entries.get(key) === created) {
        this.entries.delete(key);
      }
    });
    return created;
  }

  /** 省略 key 时清空全部；已解析的会话异步 dispose，创建失败的条目忽略。 */
  invalidate(key?: string): void {
    const targets =
      key === undefined
        ? [...this.entries.values()]
        : [this.entries.get(key)].filter((entry): entry is Promise<TSession> => Boolean(entry));

    if (key === undefined) {
      this.entries.clear();
    } else {
      this.entries.delete(key);
    }

    for (const pending of targets) {
      void pending.then(session => session.dispose()).catch(() => undefined);
    }
  }
}
