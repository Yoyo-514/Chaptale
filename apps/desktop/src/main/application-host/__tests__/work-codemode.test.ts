import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';

import {
  setupWorkSession,
  root,
  host,
  id,
  workId,
  documentId,
  call,
  restartWithTools,
  pending,
  observeRequests
} from './work-session-fixture';

setupWorkSession();

it('codemode 在审阅模式下直拿 work_* 解包业务对象，无需 tool_search 直接批量写入资料、事件与关系候选，失败时抛 Error', async () => {
  const outcome = await call('codemode', {
    code: `
      const chapter = await tools.work_read({ workId: ${JSON.stringify(workId)}, entryId: ${JSON.stringify(documentId)} });
      const general = await tools.work_write({
        workId: ${JSON.stringify(workId)},
        parentId: null,
        section: 'resource',
        format: 'markdown',
        title: '沈临',
        content: '北境守将。',
        attributes: { type: '人物', aliases: ['沈将军'], tags: ['守军'] }
      });
      const scout = await tools.work_write({
        workId: ${JSON.stringify(workId)},
        parentId: null,
        section: 'resource',
        format: 'markdown',
        title: '林越',
        content: '军中斥候。',
        attributes: { type: '人物' }
      });
      const record = await tools.work_record_write({
        workId: ${JSON.stringify(workId)},
        basis: '斥候回营。',
        resourceIds: [general.entry.entryId, scout.entry.entryId],
        text: '林越冒雪回营向沈临禀报敌情。',
        sourceId: chapter.entryId,
        sourceRevisionId: chapter.revisionId
      });
      const relation = await tools.work_relation_write({
        workId: ${JSON.stringify(workId)},
        basis: '将军守城。\\n斥候回营。',
        resourceIds: [general.entry.entryId, scout.entry.entryId],
        type: '上下级',
        directed: true,
        titles: ['主将', '斥候'],
        milestones: [{ kind: 'start', sourceId: chapter.entryId, sourceRevisionId: chapter.revisionId }]
      });
      const records = await tools.work_record_ls({ workId: ${JSON.stringify(workId)} });
      const relations = await tools.work_relation_ls({ workId: ${JSON.stringify(workId)} });
      let staleError = '';
      try {
        await tools.work_edit({
          workId: ${JSON.stringify(workId)},
          entryId: chapter.entryId,
          expectedRevisionId: 'stale-revision',
          oldText: '将军守城。',
          newText: '沈临守城。'
        });
      } catch (err) {
        staleError = err.message;
      }
      return {
        chapterTitle: chapter.title,
        recordCount: records.length,
        relationType: relations.relations[0].type,
        recordKind: record.kind,
        relationKind: relation.kind,
        staleError
      };
    `
  });

  const text = outcome.result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
  expect(outcome.isError, text).toBe(false);
  const parsed = JSON.parse(text.slice(text.indexOf('Output:\n\n') + 'Output:\n\n'.length).trim()) as {
    chapterTitle: string;
    recordCount: number;
    relationType: string;
    recordKind: string;
    relationKind: string;
    staleError: string;
  };
  expect(parsed).toMatchObject({
    chapterTitle: '序章',
    recordCount: 1,
    relationType: '上下级',
    recordKind: 'pending',
    relationKind: 'pending'
  });
  expect(parsed.staleError).toContain('revision-conflict');
  expect(pending()).toHaveLength(4);

  // 重开带 codemode 调用记录的会话，验证运行中子调用事件提取到解包前的作品标题与字数摘要。
  const session = host.liveSession(id)!;
  const parentCallId = 'cm-live-activity';
  session.sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: parentCallId, name: 'codemode', arguments: { code: 'return 1;' } }],
    api: 'openai-completions',
    provider: 'offline-tools',
    model: 'offline',
    stopReason: 'toolUse',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  });
  const file = session.sessionFile!;
  await host.execute({ method: 'close', input: { id } });
  const reopenedId = (await host.execute({ method: 'open', input: { file } })) as string;
  const toolEvents: Array<{ name: string; status: string; info?: unknown }> = [];
  const unsubscribe = host.subscribe(event => {
    if (event.kind === 'tool' && event.id === reopenedId) {
      toolEvents.push({ name: event.call.name, status: event.call.status, info: event.call.info });
    }
  });
  try {
    const reopenedSession = host.liveSession(reopenedId)!;
    const codemodeTool = reopenedSession.agent.state.tools.find(tool => tool.name === 'codemode')!;
    await codemodeTool.execute(parentCallId, {
      code: `return (await tools.work_read({ workId: ${JSON.stringify(workId)}, entryId: ${JSON.stringify(documentId)} })).title;`
    });
  } finally {
    unsubscribe();
  }
  expect(toolEvents).toContainEqual({
    name: 'work_read',
    status: 'ok',
    info: expect.objectContaining({ workId, title: '序章', section: 'manuscript' })
  });
});

it('codemode 在讨论模式下拦截常驻与延迟写工具，嵌套读取目录外文件继续走三档授权', async () => {
  const refDir = join(root, 'external-refs');
  await mkdir(refDir);
  await writeFile(join(refDir, 'a.txt'), '北境舆图');
  await writeFile(join(refDir, 'b.txt'), '兵制考');
  await host.execute({ method: 'mode', input: { id, mode: 'discuss' } });

  const running = call('codemode', {
    code: `
      const entries = await tools.work_ls({ workId: ${JSON.stringify(workId)}, entryId: null });
      let writeErr = '';
      try {
        await tools.work_record_write({
          workId: ${JSON.stringify(workId)},
          basis: '将军守城。',
          resourceIds: ['missing'],
          text: '不应写入',
          placement: 'opening'
        });
      } catch (err) {
        writeErr = err.message;
      }
      const firstRef = await tools.read({ path: ${JSON.stringify(join(refDir, 'a.txt'))} });
      const secondRef = await tools.read({ path: ${JSON.stringify(join(refDir, 'b.txt'))} });
      return { titles: entries.map(item => item.title), writeErr, firstRef, secondRef };
    `
  });

  await expect.poll(() => host.snapshot().approvals).toHaveLength(1);
  const approval = host.snapshot().approvals[0]!;
  expect(approval.toolName).toBe('read');
  await host.execute({ method: 'approve', input: { id: approval.id, allow: true, scope: 'session' } });

  const outcome = await running;
  const text = outcome.result.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('\n');
  expect(outcome.isError, text).toBe(false);
  const parsed = JSON.parse(text.slice(text.indexOf('Output:\n\n') + 'Output:\n\n'.length).trim()) as {
    titles: string[];
    writeErr: string;
    firstRef: string;
    secondRef: string;
  };
  expect(parsed).toEqual({
    titles: ['序章'],
    writeErr: '当前为讨论模式，作品只读',
    firstRef: '北境舆图',
    secondRef: '兵制考'
  });
  expect(pending()).toEqual([]);

  const live = host.liveSession(id)!;
  expect(live.systemPrompt).toContain('codemode');
});

it('持久化并重开 codemode 工具结果后，失败的 work_* 子调用错误摘要展示可读消息而非原始 JSON', async () => {
  const runtime = await restartWithTools([]);
  await observeRequests(runtime);
  const session = host.liveSession(id)!;
  const callId = 'cm-persisted-error';
  session.sessionManager.appendMessage({ role: 'user', content: '执行脚本', timestamp: Date.now() });
  session.sessionManager.appendMessage({
    role: 'assistant',
    content: [{ type: 'toolCall', id: callId, name: 'codemode', arguments: { code: 'return 1;' } }],
    api: 'offline-review-results',
    provider: 'offline-tools',
    model: 'offline',
    stopReason: 'toolUse',
    timestamp: Date.now(),
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 }
    }
  });
  const codemodeTool = session.agent.state.tools.find(tool => tool.name === 'codemode')!;
  const result = await codemodeTool.execute(callId, {
    code: `
      try {
        await tools.work_edit({
          workId: ${JSON.stringify(workId)},
          entryId: ${JSON.stringify(documentId)},
          expectedRevisionId: 'stale-rev',
          oldText: '将军守城。',
          newText: '沈临守城。'
        });
      } catch {}
      return 'done';
    `
  });
  await session.agent
    .prompt({
      role: 'toolResult',
      toolCallId: callId,
      toolName: 'codemode',
      content: result.content,
      details: result.details,
      isError: Boolean(result.isError),
      timestamp: Date.now()
    })
    .catch(() => {});

  const file = session.sessionFile!;
  await host.execute({ method: 'close', input: { id } });
  const reopenedId = (await host.execute({ method: 'open', input: { file } })) as string;
  const sessionView = host.snapshot().sessions.find(item => item.id === reopenedId)!;
  const toolResultMsg = sessionView.messages.find(msg => msg.role === 'toolResult' && msg.toolName === 'codemode')!;
  expect(toolResultMsg.nestedTools).toHaveLength(1);
  expect(toolResultMsg.nestedTools![0]).toMatchObject({
    name: 'work_edit',
    status: 'error',
    info: { workId, entryId: documentId, title: '序章', section: 'manuscript' }
  });
  expect(toolResultMsg.nestedTools![0]!.error).toBeTruthy();
  expect(toolResultMsg.nestedTools![0]!.error).not.toContain('{"ok":false');
});
