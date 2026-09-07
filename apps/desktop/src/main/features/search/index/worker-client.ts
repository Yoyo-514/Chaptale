import { Worker } from 'node:worker_threads';

import { waitForSearch } from '../abort';
import type { SearchProviderInput } from '../memory/service';
import type { IndexSearchOptions } from '../types';
import type { IndexWorkerOperations, IndexWorkerRequest, IndexWorkerResponse } from './worker-protocol';

/** Main 只转发小型请求；索引、拼音、分词及缓存恢复全部留在 worker。 */
export class WorkspaceIndexWorker {
  private worker?: Worker;
  private nextId = 0;
  private disposed = false;
  private readonly pending = new Map<
    number,
    {
      resolve: (value: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  constructor(
    private readonly cacheRoot: string,
    private readonly workerUrl = new URL(/* @vite-ignore */ './index-worker.js', import.meta.url)
  ) {}

  listAssets(cwd: string) {
    return this.call('assets', { cwd });
  }
  resolveLink(cwd: string, link: string) {
    return this.call('link', { cwd, link });
  }
  ensureReady(cwd: string) {
    return this.call('ready', { cwd });
  }
  invalidate(cwd: string, paths?: string[]) {
    return this.call('invalidate', { cwd, ...(paths ? { paths } : {}) });
  }
  search(cwd: string, query: string, options: IndexSearchOptions = {}) {
    const { signal, ...searchOptions } = options;
    return waitForSearch(this.call('search', { cwd, query, options: searchOptions }), signal);
  }
  literalSearch(input: SearchProviderInput) {
    const { signal, ...args } = input;
    return waitForSearch(this.call('literal', args), signal);
  }
  async dispose() {
    this.disposed = true;
    const worker = this.worker;
    this.fail(new Error('索引服务已关闭'));
    await worker?.terminate();
  }

  private call<K extends keyof IndexWorkerOperations>(
    method: K,
    args: IndexWorkerOperations[K]['args']
  ): Promise<IndexWorkerOperations[K]['result']> {
    if (this.disposed) return Promise.reject(new Error('索引服务已关闭'));
    const worker = this.getWorker();
    const id = ++this.nextId;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('索引请求超过 60 秒，请缩小作品范围后重试'));
        void worker.terminate();
      }, 60_000);
      this.pending.set(id, { resolve: value => resolve(value as IndexWorkerOperations[K]['result']), reject, timer });
      try {
        // worker_threads 不使用浏览器的 targetOrigin。
        // oxlint-disable-next-line unicorn/require-post-message-target-origin
        worker.postMessage({ id, method, args } as IndexWorkerRequest);
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private getWorker() {
    if (this.worker) return this.worker;
    const worker = new Worker(this.workerUrl, { workerData: { cacheRoot: this.cacheRoot } });
    worker.unref();
    this.worker = worker;
    worker.on('message', (response: IndexWorkerResponse) => {
      const pending = this.pending.get(response.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(response.id);
      if (response.ok) pending.resolve(response.value);
      else pending.reject(new Error(response.error));
    });
    worker.on('error', error => {
      if (this.worker === worker) this.fail(error instanceof Error ? error : new Error(String(error)));
    });
    worker.on('exit', code => {
      if (this.worker === worker) this.fail(new Error(`索引 worker 已退出（${code}）`));
    });
    return worker;
  }

  private fail(error: Error) {
    this.worker = undefined;
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}
