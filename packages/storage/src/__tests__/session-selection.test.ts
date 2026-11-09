import { randomUUID } from 'node:crypto';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';

import { CreationApplication } from '@chaptale/creation/application';
import type { CreationResult } from '@chaptale/creation/contracts';

import { openCreationStorage } from '../index.ts';

const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const close of cleanup.splice(0)) await close();
});
function value<T>(result: CreationResult<T>): T {
  if (!result.ok) throw new Error(result.error.message);
  return result.value;
}
async function setup() {
  const root = await mkdtemp(join(tmpdir(), 'chaptale-session-selection-'));
  let app = new CreationApplication(await openCreationStorage({ rootDir: root }));
  cleanup.push(async () => {
    app.close();
    await rm(root, { recursive: true, force: true });
  });
  const works = ['作品甲', '作品乙'].map(title =>
    value(app.executeAuthor({ method: 'createWork', input: { commandId: randomUUID(), title, kind: 'novel' } }))
  );
  return {
    app,
    works,
    async reopen() {
      app.close();
      app = new CreationApplication(await openCreationStorage({ rootDir: root }));
      return app;
    }
  };
}

it('每部作品及独立范围分别保存选中会话，重新打开作品库后保留', async () => {
  const {
    app,
    works: [first, second],
    reopen
  } = await setup();
  const a = randomUUID(),
    b = randomUUID(),
    independent = randomUUID();
  expect(value(app.executeAuthor({ method: 'readSessionState', input: {} }))).toEqual({ selections: [] });
  value(app.executeAuthor({ method: 'selectSession', input: { sessionId: a, workId: first!.id } }));
  value(app.executeAuthor({ method: 'selectSession', input: { sessionId: b, workId: second!.id } }));
  const state = value(app.executeAuthor({ method: 'selectSession', input: { sessionId: independent, workId: null } }));
  expect(state.selections).toEqual(
    expect.arrayContaining([
      { workId: first!.id, sessionId: a },
      { workId: second!.id, sessionId: b },
      { workId: null, sessionId: independent }
    ])
  );
  const reopened = await reopen();
  expect(value(reopened.executeAuthor({ method: 'readSessionState', input: {} }))).toEqual(state);
  const cleared = value(
    reopened.executeAuthor({ method: 'selectSession', input: { workId: first!.id, sessionId: null } })
  );
  expect(cleared.selections).toContainEqual({ workId: first!.id, sessionId: null });
  expect(cleared.selections).toContainEqual({ workId: second!.id, sessionId: b });
});

it('遗忘会话时清空指向它的查看位置，其他范围不变', async () => {
  const {
    app,
    works: [first, second]
  } = await setup();
  const a = randomUUID(),
    b = randomUUID();
  value(app.executeAuthor({ method: 'selectSession', input: { sessionId: a, workId: first!.id } }));
  value(app.executeAuthor({ method: 'selectSession', input: { sessionId: b, workId: second!.id } }));
  const state = value(app.executeAuthor({ method: 'forgetSessions', input: { sessionIds: [a] } }));
  expect(state.selections).toEqual(
    expect.arrayContaining([
      { workId: first!.id, sessionId: null },
      { workId: second!.id, sessionId: b }
    ])
  );
});

it('不存在的作品在写入前拒绝，独立会话仍可正常选择', async () => {
  const { app } = await setup();
  const sessionId = randomUUID();
  expect(app.executeAuthor({ method: 'selectSession', input: { sessionId, workId: randomUUID() } })).toMatchObject({
    ok: false
  });
  expect(value(app.executeAuthor({ method: 'readSessionState', input: {} }))).toEqual({ selections: [] });
  expect(value(app.executeAuthor({ method: 'selectSession', input: { sessionId, workId: null } })).selections).toEqual([
    { workId: null, sessionId }
  ]);
});
