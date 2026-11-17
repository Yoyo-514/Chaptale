import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, relative } from 'node:path';
import { expect, it } from 'vitest';

import { type HistoryItem } from '@chaptale/agent-host/protocol';
import type { WorkReplacement } from '@chaptale/creation/contracts';

import {
  setupWorkSession,
  root,
  creation,
  host,
  id,
  workId,
  documentId,
  revisionId,
  value,
  call,
  restartWithTools,
  read,
  pending,
  ownSession,
  observeRequests,
  useSession
} from './work-session-fixture';

setupWorkSession();

it('删除会话时拒绝其全部待审修改、清除查看位置、关闭会话，并返回待移入回收站的历史文件', async () => {
  const runtime = await restartWithTools([]);
  await observeRequests(runtime);
  const edited = await call('work_edit', {
    workId,
    entryId: documentId,
    expectedRevisionId: revisionId,
    oldText: '守城',
    newText: '出城'
  });
  expect(edited.isError).toBe(false);
  host.liveSession(id)!.sessionManager.appendMessage({ role: 'user', content: '改一下序章', timestamp: Date.now() });
  const sessionId = host.snapshot().sessions.find(item => item.id === id)!.sessionId!;
  useSession((await host.execute({ method: 'assignSession', input: { sessionId, workId } })) as string);
  const file = host.liveSession(id)!.sessionFile!;
  expect(pending()).toHaveLength(1);

  // 运行中的会话整体拒绝删除，待审修改保持原状。
  const live = host.liveSession(id)!;
  const send = live.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  live.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '先别删' } });
  await entered.promise;
  await expect(host.execute({ method: 'deleteSessions', input: { sessionIds: [sessionId] } })).rejects.toThrow(
    '有会话正在运行'
  );
  expect(pending()).toHaveLength(1);
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);

  value(creation.executeAuthor({ method: 'selectSession', input: { sessionId, workId } }));

  const result = await host.execute({ method: 'deleteSessions', input: { sessionIds: [sessionId] } });

  expect(result).toEqual({ files: [file] });
  const state = value(creation.executeAuthor({ method: 'readSessionState', input: {} }));
  expect(state.selections).toContainEqual({ workId, sessionId: null });
  expect(pending()).toEqual([]);
  expect(host.snapshot().sessions.some(item => item.id === id)).toBe(false);
  expect(read().content).toBe('将军守城。\n城外下雪。\n斥候回营。');
});

it('删除作品时属于它的会话在运行则拒绝；停止后移入作品库回收站、关闭会话，历史仍在作品的会话目录', async () => {
  const runtime = await restartWithTools([]);
  await observeRequests(runtime);
  await ownSession();
  const edited = await call('work_edit', {
    workId,
    entryId: documentId,
    expectedRevisionId: revisionId,
    oldText: '守城',
    newText: '出城'
  });
  expect(edited.isError).toBe(false);
  const sessionId = host.snapshot().sessions.find(item => item.id === id)!.sessionId!;

  const live = host.liveSession(id)!;
  const send = live.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  live.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '继续' } });
  await entered.promise;
  const input = { commandId: randomUUID(), workId };
  await expect(host.execute({ method: 'trashWork', input })).rejects.toThrow('有会话正在运行');
  expect(pending()).toHaveLength(1);
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);

  await host.execute({ method: 'trashWork', input });

  expect(pending()).toEqual([]);
  expect(host.snapshot().sessions.some(item => item.id === id)).toBe(false);
  expect(value(creation.executeAuthor({ method: 'listTrashedWorks', input: {} })).map(work => work.id)).toEqual([
    workId
  ]);
  const items = (await host.execute({ method: 'history', input: undefined })) as HistoryItem[];
  expect(items.find(item => item.id === sessionId)?.workId).toBe(workId);
});

it('归入作品移动历史文件并重新打开；运行中拒绝，尚未写盘与已归属的会话不能归入', async () => {
  await observeRequests(await restartWithTools([]));
  const sessions = join(root, 'sessions');
  const draft = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  await expect(host.execute({ method: 'assignSession', input: { sessionId: draft, workId } })).rejects.toThrow(
    '会话还没有内容'
  );

  const session = host.liveSession(id)!;
  session.sessionManager.appendMessage({ role: 'user', content: '归入前的消息', timestamp: Date.now() });
  const sessionId = session.sessionId;
  const original = session.sessionFile!;
  const content = await readFile(original, 'utf8');
  expect(dirname(original)).toBe(join(sessions, 'unassigned'));

  const send = session.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  session.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '继续' } });
  await entered.promise;
  await expect(host.execute({ method: 'assignSession', input: { sessionId, workId } })).rejects.toThrow('会话正在运行');
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
  const settled = await readFile(original, 'utf8');
  expect(settled.startsWith(content)).toBe(true);

  const reopened = (await host.execute({ method: 'assignSession', input: { sessionId, workId } })) as string;
  const view = host.snapshot().sessions.find(item => item.id === reopened)!;
  expect(view).toMatchObject({ sessionId, workId, file: join(sessions, workId, basename(original)) });
  expect(host.snapshot().sessions.filter(item => item.sessionId === sessionId)).toHaveLength(1);
  expect(existsSync(original)).toBe(false);
  expect(await readFile(view.file, 'utf8')).toBe(settled);
  expect(host.liveSession(reopened)!.sessionManager.getCwd()).not.toBe(join(root, 'work'));
  await expect(host.execute({ method: 'assignSession', input: { sessionId, workId } })).rejects.toThrow('已归属作品');
});

it('永久删除作品时关闭其会话，作品目录与会话目录一并交给平台移入回收站', async () => {
  const sessionId = host.snapshot().sessions.find(item => item.id === id)!.sessionId!;
  host.liveSession(id)!.sessionManager.appendMessage({ role: 'user', content: '作品会话', timestamp: Date.now() });
  useSession((await host.execute({ method: 'assignSession', input: { sessionId, workId } })) as string);
  await host.execute({ method: 'trashWork', input: { commandId: randomUUID(), workId } });
  const purged = (await host.execute({ method: 'purgeWork', input: { commandId: randomUUID(), workId } })) as {
    files: string[];
  };
  expect(purged.files.map(file => relative(root, file).replaceAll('\\', '/'))).toEqual(
    expect.arrayContaining([`creation/works/${workId}`, `sessions/${workId}`])
  );
  expect(purged.files).toHaveLength(2);
  expect(host.snapshot().sessions).toEqual([]);
  expect(value(creation.executeAuthor({ method: 'listTrashedWorks', input: {} }))).toEqual([]);
});

it('覆盖导入与恢复导入前版本：属于作品的会话在运行则拒绝；停止后替换内容并关闭会话', async () => {
  const runtime = await restartWithTools([]);
  await observeRequests(runtime);
  await ownSession();
  const path = join(await mkdtemp(join(tmpdir(), 'chaptale-package-')), '作品.chaptale');
  value(await creation.execute({ method: 'exportWorkPackage', input: { workId, path } }));

  const live = host.liveSession(id)!;
  const send = live.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  live.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  await host.execute({ method: 'prompt', input: { id, text: '继续' } });
  await entered.promise;
  const input = { commandId: randomUUID(), path, asCopy: false };
  await expect(host.execute({ method: 'importWorkPackage', input })).rejects.toThrow(
    '有会话正在运行，停止后才能覆盖作品'
  );
  expect(value(await creation.execute({ method: 'listWorkSnapshots', input: {} }))).toEqual([]);
  const copy = (await host.execute({
    method: 'importWorkPackage',
    input: { ...input, commandId: randomUUID(), asCopy: true }
  })) as WorkReplacement;
  expect(copy.work.id).not.toBe(workId);
  release.resolve();
  await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);

  await host.execute({ method: 'importWorkPackage', input });
  expect(host.snapshot().sessions.some(item => item.id === id)).toBe(false);
  expect(value(await creation.execute({ method: 'listWorkSnapshots', input: {} })).map(item => item.workId)).toEqual([
    workId
  ]);
  const restored = (await host.execute({
    method: 'restoreWorkSnapshot',
    input: { commandId: randomUUID(), workId }
  })) as WorkReplacement;
  expect(restored.files).toHaveLength(1);
  expect(value(await creation.execute({ method: 'listWorkSnapshots', input: {} }))).toEqual([]);
});
