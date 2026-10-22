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
  const root = await mkdtemp(join(tmpdir(), 'chaptale-session-ownership-'));
  let app = new CreationApplication(await openCreationStorage({ rootDir: root }));
  cleanup.push(async () => {
    app.close();
    await rm(root, { recursive: true, force: true });
  });
  const works = ['作品甲', '作品乙'].map(title =>
    value(
      app.executeAuthor({
        method: 'createWork',
        input: {
          commandId: randomUUID(),
          title,
          kind: 'novel'
        }
      })
    )
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

it('独立会话可固定归入作品，重复确认幂等，重新打开作品库后归属保留', async () => {
  const {
    app,
    works: [first, second],
    reopen
  } = await setup();
  const sessionId = randomUUID();
  expect(value(app.executeAuthor({ method: 'readSessionState', input: {} }))).toEqual({
    assignments: [],
    selections: []
  });
  const input = { sessionId, workId: first!.id };
  const assigned = value(app.executeAuthor({ method: 'assignSession', input }));
  expect(assigned.assignments).toEqual([input]);
  expect(value(app.executeAuthor({ method: 'assignSession', input }))).toEqual(assigned);
  expect(app.executeAuthor({ method: 'assignSession', input: { sessionId, workId: second!.id } })).toMatchObject({
    ok: false,
    error: { message: expect.stringContaining('固定归属') }
  });
  const reopened = await reopen();
  expect(value(reopened.executeAuthor({ method: 'readSessionState', input: {} }))).toEqual(assigned);
});

it('每部作品及独立范围分别保存选中会话，归入作品时清除独立范围的旧选择', async () => {
  const {
    app,
    works: [first, second],
    reopen
  } = await setup();
  const a = randomUUID(),
    b = randomUUID(),
    independent = randomUUID();
  for (const [sessionId, workId] of [
    [a, first!.id],
    [b, second!.id]
  ]) {
    value(app.executeAuthor({ method: 'assignSession', input: { sessionId, workId } }));
    value(app.executeAuthor({ method: 'selectSession', input: { sessionId, workId } }));
  }
  value(app.executeAuthor({ method: 'selectSession', input: { sessionId: independent, workId: null } }));
  expect(app.executeAuthor({ method: 'selectSession', input: { sessionId: a, workId: second!.id } })).toMatchObject({
    ok: false
  });
  expect(app.executeAuthor({ method: 'selectSession', input: { sessionId: a, workId: null } })).toMatchObject({
    ok: false
  });
  const state = value(
    app.executeAuthor({ method: 'assignSession', input: { sessionId: independent, workId: first!.id } })
  );
  expect(state.selections).toEqual(
    expect.arrayContaining([
      { workId: first!.id, sessionId: a },
      { workId: second!.id, sessionId: b },
      { workId: null, sessionId: null }
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

it('不存在的作品与无效身份在写入前拒绝，独立会话仍可正常选择', async () => {
  const { app } = await setup();
  const sessionId = randomUUID();
  expect(app.executeAuthor({ method: 'assignSession', input: { sessionId, workId: randomUUID() } })).toMatchObject({
    ok: false
  });
  expect(app.executeAuthor({ method: 'selectSession', input: { sessionId, workId: randomUUID() } })).toMatchObject({
    ok: false
  });
  expect(app.executeAuthor({ method: 'assignSession', input: { sessionId: '', workId: randomUUID() } })).toMatchObject({
    ok: false
  });
  expect(value(app.executeAuthor({ method: 'readSessionState', input: {} }))).toEqual({
    assignments: [],
    selections: []
  });
  expect(value(app.executeAuthor({ method: 'selectSession', input: { sessionId, workId: null } })).selections).toEqual([
    { workId: null, sessionId }
  ]);
});
