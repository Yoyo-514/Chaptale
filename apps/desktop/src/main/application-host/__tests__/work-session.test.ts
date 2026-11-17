import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { expect, it } from 'vitest';

import {
  setupWorkSession,
  root,
  creation,
  host,
  id,
  workId,
  value,
  call,
  restartWithTools,
  load,
  observeRequests,
  useSession
} from './work-session-fixture';

setupWorkSession();

it('tool_search 加载的工具随历史重开保留，下一次请求不撤下', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  await load('work_record');
  await host.execute({ method: 'prompt', input: { id, text: '列出事件' } });
  await expect.poll(() => requests.length).toBe(1);
  const view = () => host.snapshot().sessions.find(session => session.id === id)!;
  await expect.poll(() => view().running).toBe(false);
  const session = host.liveSession(id)!;
  const history = { file: session.sessionFile! };
  await host.execute({ method: 'close', input: { id } });
  useSession((await host.execute({ method: 'open', input: history })) as string);
  expect(host.liveSession(id)!.getActiveToolNames()).toEqual(
    expect.arrayContaining(['work_record_ls', 'work_record_write'])
  );
  await host.execute({ method: 'prompt', input: { id, text: '再列一次' } });
  await expect.poll(() => requests.length).toBe(2);
  expect(requests[1].messages).not.toContain('toolsRemoved');
});

it('归属作品的会话以作品文件目录为工作目录，目录内读取不逐次询问，目录外仍需作者授权', async () => {
  const owned = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId }
  })) as string;
  const session = host.liveSession(owned)!;
  const cwd = session.sessionManager.getCwd();
  expect(cwd).not.toBe(join(root, 'work'));
  await writeFile(join(cwd, '设定.txt'), '城外下雪');
  expect(session.systemPrompt).toContain(`本会话归属作品《长夜行》，作品 ID 为 ${workId}`);
  expect(dirname(session.sessionFile!)).toBe(join(root, 'sessions', workId));
  expect(host.snapshot().sessions.find(item => item.id === owned)?.workId).toBe(workId);
  await host.execute({ method: 'mode', input: { id: owned, mode: 'direct' } });

  const inside = await call('read', { path: '设定.txt' }, undefined, undefined, owned);
  expect(inside.isError).toBe(false);
  expect(JSON.stringify(inside.result.content)).toContain('城外下雪');
  expect(host.snapshot().approvals).toEqual([]);

  await writeFile(join(root, '目录外.txt'), '不应自动读取');
  const outside = call('read', { path: join(root, '目录外.txt') }, undefined, undefined, owned);
  await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
  await host.execute({ method: 'approve', input: { id: host.snapshot().approvals[0].id, allow: false } });
  expect((await outside).isError).toBe(true);
});

it('归属作品的会话将非空写作要求拼入系统提示词前缀，修改或清空后在下一轮请求生效', async () => {
  const runtime = await restartWithTools([]);
  const requests = await observeRequests(runtime);
  const owned = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId }
  })) as string;
  const view = () => host.snapshot().sessions.find(item => item.id === owned)!;
  const session = host.liveSession(owned)!;
  expect(session.systemPrompt).toContain(`本会话归属作品《长夜行》，作品 ID 为 ${workId}`);
  expect(session.systemPrompt).not.toContain('<writing_guidelines>');

  value(
    creation.executeAuthor({
      method: 'writeWritingGuidelines',
      input: {
        commandId: randomUUID(),
        workId,
        writingGuidelines: '全程使用清代白话章回体与繁体字，禁用现代网络用语。'
      }
    })
  );
  await host.execute({ method: 'prompt', input: { id: owned, text: '试写第一段' } });
  await expect.poll(() => requests.length).toBe(1);
  await expect.poll(() => view().running).toBe(false);
  expect(session.systemPrompt).toContain('<writing_guidelines>');
  expect(session.systemPrompt).toContain('全程使用清代白话章回体与繁体字，禁用现代网络用语。');

  value(
    creation.executeAuthor({
      method: 'writeWritingGuidelines',
      input: { commandId: randomUUID(), workId, writingGuidelines: '   ' }
    })
  );
  await host.execute({ method: 'prompt', input: { id: owned, text: '试写第二段' } });
  await expect.poll(() => requests.length).toBe(2);
  await expect.poll(() => view().running).toBe(false);
  expect(session.systemPrompt).not.toContain('<writing_guidelines>');
});

it('作品会话支持“为这部作品记住”目录外只读授权，同作品跨会话共享，另存副本不继承且永久删除作品时自动清理', async () => {
  const refDir = join(root, 'shared-reference');
  await mkdir(refDir, { recursive: true });
  await writeFile(join(refDir, 'chronicle.txt'), '永乐元年大事记');
  const firstSession = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId }
  })) as string;
  const secondSession = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId }
  })) as string;
  const otherWork = value(
    creation.executeAuthor({
      method: 'createWork',
      input: { commandId: randomUUID(), title: '另一部作品', kind: 'novel' }
    })
  );
  const otherWorkSession = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: otherWork.id }
  })) as string;

  const firstRead = call('read', { path: join(refDir, 'chronicle.txt') }, undefined, undefined, firstSession);
  await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
  const approval = host.snapshot().approvals[0]!;
  expect(approval.remember).toMatchObject({ capability: 'fs_read', pathKind: 'directory', allowWork: true });
  await host.execute({ method: 'approve', input: { id: approval.id, allow: true, scope: 'work' } });
  expect((await firstRead).isError).toBe(false);
  expect(host.snapshot().settings.toolPermissions).toMatchObject([{ scope: { kind: 'work', workId } }]);

  // 同作品第二个会话直接共享该目录的只读权限（含 ls / grep 等）。
  const secondLs = await call('ls', { path: refDir }, undefined, undefined, secondSession);
  expect(secondLs.isError).toBe(false);
  expect(JSON.stringify(secondLs.result.content)).toContain('chronicle.txt');
  expect(host.snapshot().approvals).toEqual([]);

  // 另一部作品不共享该规则。
  const otherRead = call('read', { path: join(refDir, 'chronicle.txt') }, undefined, undefined, otherWorkSession);
  await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
  await host.execute({ method: 'approve', input: { id: host.snapshot().approvals[0]!.id, allow: false } });
  expect((await otherRead).isError).toBe(true);

  // 导出作品包再另存为副本导入，新作品不携带原作品的本机授权。
  const pkgPath = join(root, 'export.chaptale-work');
  const exported = await creation.execute({ method: 'exportWorkPackage', input: { workId, path: pkgPath } });
  expect(exported.ok).toBe(true);
  const imported = (await host.execute({
    method: 'importWorkPackage',
    input: { commandId: randomUUID(), path: pkgPath, asCopy: true }
  })) as { work: { id: string } };
  const copySession = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: imported.work.id }
  })) as string;
  const copyRead = call('read', { path: join(refDir, 'chronicle.txt') }, undefined, undefined, copySession);
  await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
  await host.execute({ method: 'approve', input: { id: host.snapshot().approvals[0]!.id, allow: false } });
  expect((await copyRead).isError).toBe(true);

  // 移入回收站并永久删除作品后，自动清理该作品的本机授权规则。
  await host.execute({ method: 'trashWork', input: { commandId: randomUUID(), workId } });
  await host.execute({ method: 'purgeWork', input: { commandId: randomUUID(), workId } });
  expect(host.snapshot().settings.toolPermissions).toEqual([]);
});
