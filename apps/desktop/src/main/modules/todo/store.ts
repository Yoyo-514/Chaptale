import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { TodoItem } from '@chaptale/shared';

export type TodoChangeListener = (sessionId: string, items: TodoItem[]) => void;

/**
 * 会话隔离的 todo 存储：每个会话一个 JSON 文件。
 *
 * 所有写入经由 mutate 队列串行化：读-改-写-通知为一个原子单元，
 * 模型并行调用工具时增量更新不会互相覆盖；变更在写盘成功后广播给监听器。
 */
export class TodoStore {
  private readonly listeners = new Set<TodoChangeListener>();
  // 写队列：单次失败不阻断后续写入。
  private writeQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly todosDir: string) {}

  async read(sessionId: string): Promise<TodoItem[]> {
    try {
      const raw = await fs.readFile(this.fileFor(sessionId), 'utf8');
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as TodoItem[]) : [];
    } catch {
      // 文件不存在或损坏都按空表处理：todo 是过程性数据，不值得为它中断会话。
      return [];
    }
  }

  /**
   * 原子变更：在写队列内读取当前清单 → mutator 产出新表 → 写盘 → 通知。
   *
   * mutator 抛错则不写盘不通知（语义校验失败的拒绝路径）；返回写入后的新表。
   */
  async mutate(sessionId: string, mutator: (current: TodoItem[]) => TodoItem[]): Promise<TodoItem[]> {
    const task = this.writeQueue.then(async () => {
      const next = mutator(await this.read(sessionId));

      await fs.mkdir(this.todosDir, { recursive: true });
      await fs.writeFile(this.fileFor(sessionId), `${JSON.stringify(next, null, 2)}\n`, 'utf8');

      for (const listener of this.listeners) {
        listener(sessionId, next);
      }

      return next;
    });

    this.writeQueue = task.catch(() => undefined);
    return task;
  }

  /** 整表替换（mutate 的便捷形式）。 */
  async replace(sessionId: string, items: TodoItem[]): Promise<void> {
    await this.mutate(sessionId, () => items);
  }

  /** 随会话删除清理对应 todo 文件；文件不存在时静默成功。 */
  async remove(sessionId: string): Promise<void> {
    await fs.rm(this.fileFor(sessionId), { force: true });
  }

  onChange(listener: TodoChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private fileFor(sessionId: string): string {
    // sessionId 参与文件名，保守清洗防目录逃逸。
    const safeName = sessionId.replace(/[^a-zA-Z0-9_-]/g, '_');
    return path.join(this.todosDir, `${safeName}.json`);
  }
}
