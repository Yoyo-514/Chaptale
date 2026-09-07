import { parentPort, workerData } from 'node:worker_threads';

import { parseDocumentHead } from '../../workspace/frontmatter';
import { AssetCatalog } from './asset-catalog';
import { LiteralSearchProvider } from './literal-provider';
import { IndexService } from './service';
import { WorkspaceIndexSourceResolver } from './source-resolver';
import type { IndexWorkerRequest, IndexWorkerResponse } from './worker-protocol';

if (!parentPort) throw new Error('索引入口只能在 worker 内启动');
const port = parentPort;
const { cacheRoot } = workerData as { cacheRoot: string };
const resolver = new WorkspaceIndexSourceResolver();
const parseFrontmatter = (content: string) => {
  const head = parseDocumentHead(content);
  if (head.status === 'invalid') throw new Error(head.error);
  return { frontmatter: head.status === 'ok' ? head.frontmatter : {}, body: head.body };
};
const index = new IndexService({ resolver, parseFrontmatter, cacheRoot });
const catalog = new AssetCatalog(cacheRoot);
const literal = new LiteralSearchProvider({ resolver, parseFrontmatter });
const queues = new Map<string, Promise<void>>();

async function execute(request: IndexWorkerRequest): Promise<unknown> {
  switch (request.method) {
    case 'assets':
      return catalog.list(request.args.cwd);
    case 'link':
      return catalog.resolveLink(request.args.cwd, request.args.link);
    case 'search':
      return index.search(request.args.cwd, request.args.query, request.args.options);
    case 'literal':
      return literal.search(request.args);
    case 'ready':
      return index.ensureReady(request.args.cwd);
    case 'invalidate':
      catalog.invalidate(request.args.cwd, request.args.paths);
      return index.invalidate(request.args.cwd);
  }
}

port.on('message', (request: IndexWorkerRequest) => {
  const cwd = request.args.cwd;
  const pending = (queues.get(cwd) ?? Promise.resolve())
    .then(async () => {
      try {
        port.postMessage({ id: request.id, ok: true, value: await execute(request) } satisfies IndexWorkerResponse);
      } catch (error) {
        port.postMessage({ id: request.id, ok: false, error: String(error) } satisfies IndexWorkerResponse);
      }
    })
    .finally(() => {
      if (queues.get(cwd) === pending) queues.delete(cwd);
    });
  queues.set(cwd, pending);
});
