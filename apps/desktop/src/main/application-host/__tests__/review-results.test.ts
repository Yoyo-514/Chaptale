import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';

import { reviewResultsMessageType } from '@chaptale/agent-host/protocol';

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
  observeRequests,
  decidePending,
  finishToolTurn,
  useSession
} from './work-session-fixture';

setupWorkSession();

it('审阅写入不打断本轮，完成本次请求后停下并保留候选', async () => {
  await host.liveSession(id)!.reload();
  const writing = await call('work_write', {
    workId,
    entryId: documentId,
    expectedRevisionId: revisionId,
    content: '待审正文'
  });
  expect(writing.isError).toBe(false);
  expect(await finishToolTurn(writing)).toBeUndefined();
  expect(pending()).toHaveLength(1);
  expect(read().revisionId).toBe(revisionId);
  expect(host.snapshot().sessions.find(session => session.id === id)!.running).toBe(false);
});

it.each(['先停止', '决定后立即停止', '关闭会话'] as const)(
  '%s后作者决定保持空闲，下一条消息才交出结果',
  async timing => {
    const runtime = await restartWithTools([]);
    const requests = await observeRequests(runtime);
    expect(
      (
        await call('work_write', {
          workId,
          entryId: documentId,
          expectedRevisionId: revisionId,
          content: '实际接受的正文'
        })
      ).isError
    ).toBe(false);
    const session = host.liveSession(id)!;
    session.sessionManager.appendMessage({ role: 'user', content: '稍后继续写作', timestamp: Date.now() });
    const history = { file: session.sessionFile! };
    if (timing === '决定后立即停止') decidePending('accept');
    await host.execute({ method: timing === '关闭会话' ? 'close' : 'cancel', input: { id } });
    if (timing !== '决定后立即停止') decidePending('accept');
    expect(requests).toHaveLength(0);
    if (timing === '关闭会话') useSession((await host.execute({ method: 'open', input: history })) as string);
    const view = () => host.snapshot().sessions.find(item => item.id === id)!;
    expect(view().running).toBe(false);
    await host.execute({ method: 'prompt', input: { id, text: '继续余下任务' } });
    await expect.poll(() => requests.length).toBe(1);
    await expect.poll(() => view().running).toBe(false);
    expect(requests[0].messages).toContain('实际接受的正文');
    expect(requests[0].messages.indexOf('作者已处理')).toBeLessThan(requests[0].messages.indexOf('继续余下任务'));
  }
);

it('部分正文已处理后随下一条消息送达，剩余候选继续待审；再次发送不重复插入结果', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '将军出城。\n城外下雪。\n斥候远行。'
      })
    ).isError
  ).toBe(false);
  const review = value(creation.executeAuthor({ method: 'readReview', input: { changeId: pending()[0].id } }));
  value(
    creation.executeAuthor({
      method: 'decideReview',
      input: {
        commandId: randomUUID(),
        changeId: review.change.id,
        expectedVersion: review.change.version,
        expectedRevisionId: review.current!.revisionId,
        expectedLocation: { parentId: null, position: 0 },
        decision: 'accept',
        range: { fromA: 0, toA: 5, fromB: 0, toB: 5 }
      }
    })
  );
  expect(requests).toHaveLength(0);
  expect(pending()).toHaveLength(1);
  await host.execute({ method: 'prompt', input: { id, text: '解释余下的修改' } });
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  await expect.poll(() => view().running).toBe(false);
  expect(requests).toHaveLength(1);
  expect(requests[0].messages).toContain('将军出城');
  expect(view().messages.filter(message => message.role === 'reviewResults')).toMatchObject([
    { text: '作者已处理 1 处修改' }
  ]);
  expect(pending()).toHaveLength(1);
  await host.execute({ method: 'prompt', input: { id, text: '再解释一下' } });
  await expect.poll(() => view().running).toBe(false);
  expect(requests).toHaveLength(2);
  expect(view().messages.filter(message => message.role === 'reviewResults')).toHaveLength(1);
});

it('拒绝片段与正式稿写入原生消息，界面只展示逐处摘要', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '被拒绝的候选正文'
      })
    ).isError
  ).toBe(false);
  decidePending('reject');
  expect(requests).toHaveLength(0);
  await host.execute({ method: 'prompt', input: { id, text: '请说明刚才的建议' } });
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  await expect.poll(() => view().running).toBe(false);
  expect(requests[0].messages).toContain('被拒绝的候选正文');
  expect(requests[0].messages).toContain('不要原样重做');
  expect(requests[0].messages).toContain('将军守城');
  const notices = view().messages.filter(message => message.role === 'reviewResults');
  expect(notices).toMatchObject([
    { text: '作者已处理 1 处修改', outcomes: [{ id: expect.any(String), text: '《序章》·正文已拒绝' }] }
  ]);
  expect(view().messages.some(message => message.text.includes('各处决定与原文'))).toBe(false);
});

it('自定义消息已写盘而本机送达进度失败，重开补进度并只保留一条结果消息', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '实际接受的正文'
      })
    ).isError
  ).toBe(false);
  decidePending('accept');
  const session = host.liveSession(id)!;
  session.sessionManager.appendMessage({ role: 'user', content: '先前任务', timestamp: Date.now() });
  const history = { file: session.sessionFile! };
  const fault = new DatabaseSync(join(root, 'creation', 'library.sqlite'));
  try {
    fault.exec(
      "CREATE TRIGGER fail_reporting BEFORE UPDATE ON review_results BEGIN SELECT RAISE(ABORT, '送达进度故障'); END"
    );
    await host.execute({ method: 'prompt', input: { id, text: '继续任务' } });
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    expect(requests).toHaveLength(0);
    expect(
      session.sessionManager
        .getBranch()
        .filter(entry => entry.type === 'custom_message' && entry.customType === reviewResultsMessageType)
    ).toHaveLength(1);
    fault.exec('DROP TRIGGER fail_reporting');
    await host.execute({ method: 'close', input: { id } });
    useSession((await host.execute({ method: 'open', input: history })) as string);
    await host.execute({ method: 'prompt', input: { id, text: '重新继续任务' } });
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    expect(requests).toHaveLength(1);
    expect(
      host
        .liveSession(id)!
        .sessionManager.getBranch()
        .filter(entry => entry.type === 'custom_message' && entry.customType === reviewResultsMessageType)
    ).toHaveLength(1);
    expect(value(creation.executeAuthor({ method: 'listReviewResults', input: { sessionId: id } }))).toEqual([]);
  } finally {
    fault.close();
  }
});

it('生成中插话使用SDK原生队列，结果在对应消息前入队，连续插话各自捕获快照', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '将军出城。\n城外下雪。\n斥候远行。'
      })
    ).isError
  ).toBe(false);
  const session = host.liveSession(id)!;
  const send = session.agent.streamFunction;
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  session.agent.streamFunction = async (...args) => {
    entered.resolve();
    await release.promise;
    return send(...args);
  };
  try {
    await host.execute({ method: 'prompt', input: { id, text: '解释原建议' } });
    await entered.promise;
    const change = pending()[0];
    const review = value(creation.executeAuthor({ method: 'readReview', input: { changeId: change.id } }));
    value(
      creation.executeAuthor({
        method: 'decideReview',
        input: {
          commandId: randomUUID(),
          changeId: change.id,
          expectedVersion: change.version,
          expectedRevisionId: review.current!.revisionId,
          expectedLocation: { parentId: null, position: 0 },
          decision: 'accept',
          range: { fromA: 0, toA: 5, fromB: 0, toB: 5 }
        }
      })
    );
    await host.execute({ method: 'prompt', input: { id, text: '第一条插话' } });
    decidePending('reject');
    await host.execute({ method: 'prompt', input: { id, text: '第二条插话' } });
    expect(session.getSteeringMessages()).toEqual(['第一条插话', '第二条插话']);
    release.resolve();
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    expect(requests).toHaveLength(3);
    const resultMessages = session.sessionManager
      .getBranch()
      .filter(entry => entry.type === 'custom_message' && entry.customType === reviewResultsMessageType);
    expect(resultMessages).toHaveLength(2);
    expect(
      resultMessages.map(entry => entry.type === 'custom_message' && (entry.details as { count: number }).count)
    ).toEqual([1, 1]);
    expect(JSON.stringify(resultMessages[0])).toContain('将军出城');
    expect(JSON.stringify(resultMessages[0])).not.toContain('斥候远行');
    expect(JSON.stringify(resultMessages[1])).toContain('斥候远行');
  } finally {
    release.resolve();
    await expect.poll(() => host.snapshot().sessions.find(item => item.id === id)!.running).toBe(false);
    session.agent.streamFunction = send;
  }
});

it('原地分叉前若有未处理待审修改需确认撤回，撤回后不会把旧分支拒绝回执带入新分支', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  await host.execute({ method: 'prompt', input: { id, text: '修改序章' } });
  await expect.poll(() => requests.length).toBe(1);
  const view = () => host.snapshot().sessions.find(item => item.id === id)!;
  await expect.poll(() => view().running).toBe(false);
  const firstUser = view().messages.find(message => message.role === 'user')!;

  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '将军登城。\n城外下雪。\n斥候回营。'
      })
    ).isError
  ).toBe(false);
  const sessionId = view().sessionId!;
  expect(value(creation.executeAuthor({ method: 'listReviewItems', input: { sessionId } }))).toHaveLength(1);

  await expect(
    host.execute({ method: 'editMessage', input: { id, entryId: firstUser.entryId!, text: '换一种写法' } })
  ).rejects.toThrow('当前分支有未处理的待审修改');
  expect(value(creation.executeAuthor({ method: 'listReviewItems', input: { sessionId } }))).toHaveLength(1);

  await host.execute({
    method: 'editMessage',
    input: { id, entryId: firstUser.entryId!, text: '换一种写法', discardPending: true }
  });
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => view().running).toBe(false);

  expect(requests[1]!.messages).not.toContain('已拒绝');
  expect(value(creation.executeAuthor({ method: 'listReviewItems', input: { sessionId } }))).toEqual([]);
  expect(value(creation.executeAuthor({ method: 'listReviewResults', input: { sessionId } }))).toEqual([]);
  expect(view().messages.some(message => message.role === 'reviewResults')).toBe(false);
  expect(view().messages.find(message => message.role === 'user')).toMatchObject({
    text: '换一种写法',
    branch: { index: 2, total: 2 }
  });
});
