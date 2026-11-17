import {
  createLsToolDefinition,
  createReadToolDefinition,
  defineTool,
  SessionManager
} from '@earendil-works/pi-coding-agent';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Type } from 'typebox';
import { expect, it } from 'vitest';

import { instructionsEntryType, modeEntryType } from '../../protocol/index.ts';
import {
  setupHost,
  root,
  app,
  options,
  capture,
  builtin,
  zeroUsage,
  create,
  open,
  view,
  restart
} from './host-fixture.ts';

setupHost();

it('原生嵌套调用逐步更新界面，完成后沿用原生子调用记录重开', async () => {
  await writeFile(join(options.cwd, '第一章.txt'), '将军守城。');
  await writeFile(join(options.cwd, '第二章.txt'), '公主远行。');
  let release!: () => void;
  let reached!: () => void;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  const first = new Promise<void>(resolve => {
    reached = resolve;
  });
  const batch = defineTool({
    name: 'batch_read',
    label: '批量读取',
    description: '读取两份临时章节',
    parameters: Type.Object({}),
    async execute(_id, _input, _signal, _update, ctx) {
      await ctx.executeTool('read', { path: '第一章.txt' });
      reached();
      await gate;
      await ctx.executeTool('read', { path: '第二章.txt' });
      return { content: [{ type: 'text' as const, text: '实际读取完成' }], details: undefined };
    }
  });
  await restart({ tools: () => [batch, defineTool(createReadToolDefinition(options.cwd))] });
  const manager = SessionManager.create(options.cwd, join(options.sessionDir, 'unassigned'));
  manager.appendCustomEntry(instructionsEntryType, { entries: builtin });
  manager.appendCustomEntry(modeEntryType, { mode: 'review' });
  manager.appendMessage({ role: 'user', content: '读取两章', timestamp: Date.UTC(2026, 10, 13) });
  manager.appendMessage({
    role: 'assistant',
    api: 'openai-completions',
    provider: capture.provider,
    model: capture.id,
    content: [{ type: 'toolCall', id: 'batch', name: 'batch_read', arguments: {} }],
    usage: zeroUsage,
    stopReason: 'toolUse',
    timestamp: Date.UTC(2026, 10, 13) + 1
  });
  const id = await open({ file: manager.getSessionFile()! });
  await app.execute({ method: 'model', input: { id, model: capture } });
  const session = app.liveSession(id)!;
  const off = app.subscribe(event => {
    if (event.kind === 'approval')
      void app.execute({ method: 'approve', input: { id: event.approval.id, allow: true } });
  });
  const executing = session.agent.state.tools.find(tool => tool.name === 'batch_read')!.execute('batch', {});
  try {
    await first;
    expect(view(id).messages.find(message => message.role === 'assistant')!.tools[0].nestedTools).toMatchObject([
      { name: 'read', status: 'ok', preview: { path: '第一章.txt' } }
    ]);
  } finally {
    release();
    await executing;
    off();
  }
  const result = await executing;
  await session.agent.prompt({
    role: 'toolResult',
    toolCallId: 'batch',
    toolName: 'batch_read',
    content: result.content,
    details: result.details,
    isError: false,
    timestamp: Date.UTC(2026, 10, 13) + 2
  });
  const completed = view(id).messages.find(message => message.role === 'toolResult')!;
  expect(completed.nestedTools?.map(call => [call.name, call.status])).toEqual([
    ['read', 'ok'],
    ['read', 'ok']
  ]);
  const file = view(id).file;
  await app.execute({ method: 'close', input: { id } });
  expect(view(await open({ file })).messages.find(message => message.role === 'toolResult')!.nestedTools).toEqual(
    completed.nestedTools
  );
});

it('已经结束的授权请求不能被批准', async () => {
  await expect(app.execute({ method: 'approve', input: { id: 'finished', allow: true } })).rejects.toThrow(
    '授权请求已结束'
  );
});

it('独立会话支持“本会话允许”并发放行、重开保留、手动撤销与删除会话清理，且拒绝保存作品级规则', async () => {
  const refDir = join(root, 'external-ref');
  await mkdir(refDir, { recursive: true });
  await writeFile(join(refDir, 'first.txt'), '卷一内容');
  await writeFile(join(refDir, 'second.txt'), '卷二内容');
  await restart({
    tools: cwd => [defineTool(createReadToolDefinition(cwd)), defineTool(createLsToolDefinition(cwd))]
  });

  const id = await create(undefined, capture);
  app.liveSession(id)!.sessionManager.appendMessage({
    role: 'user',
    content: '查阅外部史料',
    timestamp: Date.UTC(2026, 10, 14)
  });
  const other = await create(undefined, capture);
  const runTool = (sessionId: string, name: string, input: Record<string, unknown>) =>
    app
      .liveSession(sessionId)!
      .agent.state.tools.find(tool => tool.name === name)!
      .execute(`${name}-${Math.random()}`, input);

  // 并发发起同目录的 read 与 ls，挂起两条请求，独立会话 remember.allowWork 为 false。
  const firstCall = runTool(id, 'read', { path: join(refDir, 'first.txt') });
  const secondCall = runTool(id, 'ls', { path: refDir });
  await expect.poll(() => app.snapshot().approvals.length).toBe(2);
  const firstApproval = app.snapshot().approvals[0]!;
  expect(firstApproval.remember).toMatchObject({ capability: 'fs_read', pathKind: 'directory', allowWork: false });

  await expect(
    app.execute({ method: 'approve', input: { id: firstApproval.id, allow: true, scope: 'work' } })
  ).rejects.toThrow('当前会话不支持保存作品级授权');

  // 批准第一条为“本会话允许”后，同目录第二条挂起请求一并自动放行。
  await app.execute({ method: 'approve', input: { id: firstApproval.id, allow: true, scope: 'session' } });
  expect(app.snapshot().approvals).toEqual([]);
  expect(JSON.stringify((await firstCall).content)).toContain('卷一内容');
  expect(JSON.stringify((await secondCall).content)).toContain('second.txt');
  expect(app.snapshot().settings.toolPermissions).toHaveLength(1);

  // 另一个会话不共享“本会话允许”，仍需单独授权。
  const otherCall = runTool(other, 'read', { path: join(refDir, 'second.txt') });
  await expect.poll(() => app.snapshot().approvals.length).toBe(1);
  await app.execute({ method: 'approve', input: { id: app.snapshot().approvals[0]!.id, allow: false } });
  await expect(otherCall).rejects.toThrow('工具调用未获授权');

  // 持久化：重启宿主并重开原会话后，“本会话允许”依然生效。
  const sessionFile = view(id).file;
  const sessionId = view(id).sessionId!;
  await restart({
    tools: cwd => [defineTool(createReadToolDefinition(cwd)), defineTool(createLsToolDefinition(cwd))]
  });
  const reopened = await open({ file: sessionFile });
  const thirdCall = await runTool(reopened, 'read', { path: join(refDir, 'second.txt') });
  expect(JSON.stringify(thirdCall.content)).toContain('卷二内容');
  expect(app.snapshot().approvals).toEqual([]);

  // 撤销规则后立即恢复询问；再次记住后删除会话会自动清理对应规则。
  const permissionId = app.snapshot().settings.toolPermissions[0]!.id;
  await app.execute({ method: 'revokeToolPermission', input: { id: permissionId } });
  expect(app.snapshot().settings.toolPermissions).toEqual([]);

  const afterRevoke = runTool(reopened, 'read', { path: join(refDir, 'first.txt') });
  await expect.poll(() => app.snapshot().approvals.length).toBe(1);
  await app.execute({
    method: 'approve',
    input: { id: app.snapshot().approvals[0]!.id, allow: true, scope: 'session' }
  });
  await afterRevoke;
  expect(app.snapshot().settings.toolPermissions).toHaveLength(1);

  await app.execute({ method: 'deleteSessions', input: { sessionIds: [sessionId] } });
  expect(app.snapshot().settings.toolPermissions).toEqual([]);
});
