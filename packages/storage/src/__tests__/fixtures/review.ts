import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult, PendingChange, ReviewView } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../../index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
export function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
export async function application() {
  const rootDir = await mkdtemp(join(tmpdir(), 'chaptale-review-'));
  let app = new CreationApplication(await openCreationStorage({ rootDir }));
  cleanup.push(async () => {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  });
  const work = value(
    app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
  );
  const document = value(
    app.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId: work.id,
        parentId: null,
        section: 'manuscript',
        kind: 'document',
        title: '序章',
        format: 'txt',
        content: '将军守城。\n公主远行。'
      }
    })
  );
  const context = { sessionId: 'session-a', mode: 'review' as const };
  function propose(content: string, title = document.title): PendingChange {
    const result = value(
      app.executeAgent(context, {
        method: 'writeDocument',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          documentId: document.id,
          expectedRevisionId: document.revisionId,
          title,
          format: 'txt',
          content
        }
      })
    );
    if (result.kind !== 'pending') throw new Error('预期生成待接受修改');
    return result.change;
  }
  function save(content: string) {
    const current = value(
      app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: document.id } })
    );
    return value(
      app.executeAuthor({
        method: 'saveDocument',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          documentId: document.id,
          expectedRevisionId: current.revisionId,
          title: current.title,
          format: current.format,
          content
        }
      })
    );
  }
  function read() {
    return value(app.executeAuthor({ method: 'readDocument', input: { workId: work.id, documentId: document.id } }));
  }
  return {
    rootDir,
    get app() {
      return app;
    },
    work,
    document,
    context,
    propose,
    save,
    read,
    async reopen() {
      app.close();
      app = new CreationApplication(await openCreationStorage({ rootDir }));
    }
  };
}
export function target(view: ReviewView) {
  return {
    changeId: view.change.id,
    expectedVersion: view.change.version,
    expectedRevisionId: view.current?.revisionId ?? null,
    expectedLocation: view.current ? { parentId: view.current.parentId, position: view.current.position } : null
  };
}
