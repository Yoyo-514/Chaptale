import { realpath } from 'node:fs/promises';
import path from 'node:path';

const queues = new Map<string, Promise<unknown>>();

async function canonicalPath(target: string): Promise<string> {
  const resolved = path.resolve(target);
  try {
    return await realpath(resolved);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    const parent = path.dirname(resolved);
    if (parent === resolved) throw error;
    return path.join(await canonicalPath(parent), path.basename(resolved));
  }
}

/** 应用内的读-校验-写共享一把路径锁；失败释放队列，链接别名与 Windows 大小写归一。 */
export async function withFileWriteLock<T>(target: string, action: () => Promise<T>): Promise<T> {
  const canonical = await canonicalPath(target);
  const key = process.platform === 'win32' ? canonical.toLowerCase() : canonical;
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(action, action);
  queues.set(key, next);
  try {
    return await next;
  } finally {
    if (queues.get(key) === next) queues.delete(key);
  }
}
