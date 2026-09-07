import { watch, type FSWatcher } from 'chokidar';
import path from 'node:path';

import type { WorkspaceChanged } from '@chaptale/ipc-contract';

import { DEFAULT_IGNORED_DIRS } from '../../infra/filesystem/path-guard';

/** 只发布相对路径失效通知；不以时间窗吞掉自身写入之后的外部修改。 */
export class WorkspaceWatcher {
  private watcher?: FSWatcher;
  private rootPath: string | null = null;
  private requestedRoot: string | null = null;
  private transition = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private readonly changes = new Map<string, WorkspaceChanged['changes'][number]>();
  private readonly listeners = new Set<(event: WorkspaceChanged) => void>();

  onChange(listener: (event: WorkspaceChanged) => void) {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  setRoot(rootPath: string | null): Promise<void> {
    if (this.requestedRoot === rootPath) return this.transition;
    this.requestedRoot = rootPath;
    const change = async () => {
      clearTimeout(this.timer);
      this.timer = undefined;
      this.changes.clear();
      await this.watcher?.close();
      this.watcher = undefined;
      this.rootPath = rootPath;
      if (!rootPath || rootPath !== this.requestedRoot) return;
      const watcher = watch(rootPath, {
        ignoreInitial: true,
        followSymlinks: false,
        atomic: 100,
        awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 40 },
        ignored: target =>
          path
            .relative(rootPath, target)
            .split(path.sep)
            .some(part => DEFAULT_IGNORED_DIRS.has(part) || part.startsWith('.chaptale-create-'))
      });
      this.watcher = watcher;
      watcher.on('all', (type, target) => {
        if (this.watcher !== watcher || this.requestedRoot !== rootPath) return;
        if (type !== 'add' && type !== 'change' && type !== 'unlink' && type !== 'addDir' && type !== 'unlinkDir')
          return;
        const relativePath = path.relative(rootPath, target).split(path.sep).join('/');
        if (relativePath.startsWith('../') || path.isAbsolute(relativePath)) return;
        this.changes.set(relativePath, { relativePath, type });
        // 固定批次时窗，持续写入也会在窗口结束时刷新。
        this.timer ??= setTimeout(() => this.flush(), 100);
      });
      watcher.on('error', error => {
        if (this.watcher === watcher) this.emit([], String(error));
      });
      await new Promise<void>(resolve => {
        watcher.once('ready', resolve);
        watcher.once('error', () => resolve());
      });
    };
    this.transition = this.transition.then(change, change);
    return this.transition;
  }

  async dispose() {
    await this.setRoot(null);
    this.listeners.clear();
  }

  private flush() {
    this.timer = undefined;
    const changes = [...this.changes.values()];
    this.changes.clear();
    if (changes.length) this.emit(changes);
  }

  private emit(changes: WorkspaceChanged['changes'], error?: string) {
    if (!this.rootPath || this.rootPath !== this.requestedRoot) return;
    const event = { rootPath: this.rootPath, sequence: ++this.sequence, changes, ...(error ? { error } : {}) };
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* 单个消费者失败不能阻止其他失效通知。 */
      }
    }
  }
}
