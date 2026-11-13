import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}

it('按作品和文档身份恢复标签、两棵树与阅读位置，拒绝无效位置且保留已存状态', async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), 'chaptale-navigation-'));
  let app = new CreationApplication(await openCreationStorage({ rootDir }));
  try {
    expect(value(await app.execute({ method: 'readWorkbench', input: {} }))).toEqual({ activeWorkId: null, works: [] });
    const work = value(
      await app.execute({ method: 'createWork', input: { commandId: randomUUID(), title: '长夜行', kind: 'novel' } })
    );
    const entry = value(
      await app.execute({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId: work.id,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title: '雨夜',
          format: 'txt',
          content: '雨未停。'
        }
      })
    );
    const state = {
      activeWorkId: work.id,
      works: [
        {
          workId: work.id,
          activeGroup: 1 as const,
          groups: [
            {
              activeDocumentId: entry.id,
              tabs: [{ documentId: entry.id, anchor: 2, head: 3, scrollTop: 80, scrollLeft: 0 }]
            },
            {
              activeDocumentId: entry.id,
              tabs: [{ documentId: entry.id, anchor: 0, head: 2, scrollTop: 12, scrollLeft: 0 }]
            }
          ] as [
            {
              activeDocumentId: string;
              tabs: { documentId: string; anchor: number; head: number; scrollTop: number; scrollLeft: number }[];
            },
            {
              activeDocumentId: string;
              tabs: { documentId: string; anchor: number; head: number; scrollTop: number; scrollLeft: number }[];
            }
          ],
          section: 'manuscript' as const,
          manuscript: { expandedIds: [], selectedId: entry.id, scrollTop: 32 },
          resource: { expandedIds: [], selectedId: null, scrollTop: 0 }
        }
      ]
    };
    expect(value(await app.execute({ method: 'writeWorkbench', input: state }))).toEqual(state);
    app.close();
    app = new CreationApplication(await openCreationStorage({ rootDir }));
    expect(value(await app.execute({ method: 'readWorkbench', input: {} }))).toEqual(state);
    expect(
      await app.execute({
        method: 'writeWorkbench',
        input: {
          ...state,
          works: [
            {
              ...state.works[0],
              groups: [
                {
                  activeDocumentId: entry.id,
                  tabs: [{ documentId: entry.id, anchor: -1, head: 0, scrollTop: 0, scrollLeft: 0 }]
                }
              ]
            }
          ]
        }
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(
      await app.execute({
        method: 'writeWorkbench',
        input: {
          ...state,
          works: [
            {
              ...state.works[0],
              activeGroup: 1,
              groups: [state.works[0].groups[0]] as unknown as (typeof state.works)[0]['groups']
            }
          ]
        }
      })
    ).toMatchObject({ ok: false, error: { code: 'invalid-request' } });
    expect(value(await app.execute({ method: 'readWorkbench', input: {} }))).toEqual(state);
    expect(
      value(await app.execute({ method: 'readDocument', input: { workId: work.id, documentId: entry.id } }))
    ).toMatchObject({ content: '雨未停。' });
  } finally {
    app.close();
    await rm(rootDir, { recursive: true, force: true });
  }
});
