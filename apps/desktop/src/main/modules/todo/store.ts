import { promises as fs } from 'node:fs';
import path from 'node:path';

import type { TodoItem } from '@chaptale/shared';

export type TodoChangeListener = (sessionId: string, items: TodoItem[]) => void;

/**
 * 会话隔离的 todo 存储：每个会话一个 JSON 文件，整表替换语义。
 *
 * 变更通过监听器同步广播（写盘成功后触发），供 IPC 层推送给渲染进程。
 */
export class TodoStore {
  private readonly listeners = new Set<TodoChangeListener>();

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

  async replace(sessionId: string, items: TodoItem[]): Promise<void> {
    await fs.mkdir(this.todosDir, { recursive: true });
    await fs.writeFile(this.fileFor(sessionId), `${JSON.stringify(items, null, 2)}\n`, 'utf8');

    for (const listener of this.listeners) {
      listener(sessionId, items);
    }
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
