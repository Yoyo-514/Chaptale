import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

function deferred() {
  let resolve;
  const promise = new Promise(done => {
    resolve = done;
  });
  return { promise, resolve };
}

/** Windows Node、Electron utilityProcess 与 Android 原生 Node 运行同一入口，不替换 SDK 或创建模型服务器。 */
export async function verifyHostPhase(runDir, phase) {
  const { defineTool } = await import('@earendil-works/pi-coding-agent');
  const { Type } = await import('typebox');
  const { HostSessionPool, createHostModelRuntime } = await import('../src/index.ts');
  const model = JSON.parse(await readFile(join(runDir, 'selection.json'), 'utf8'));
  const cwd = join(runDir, 'work');
  const pool = await HostSessionPool.create({
    agentDir: join(runDir, 'agent'),
    sessionDir: join(runDir, 'sessions'),
    modelRuntime: await createHostModelRuntime({ configDir: join(runDir, 'config') })
  });
  const input = {
    cwd,
    model,
    systemPrompt:
      '你是工具连接验证助手。只调用用户明确指定的工具，调用一次即可。工具失败后不要重试，不要猜测文件内容。答案只保留一句短文本。'
  };
  const endings = new Map();
  const executions = new Map();
  const requests = [];
  const gates = new Map();
  const entered = new Map();
  const subscriptions = [];
  let deny = false;
  let timer;
  const deadline = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error('跨会话真实验证超过宿主期限'));
    }, 150_000);
  });
  const read = defineTool({
    name: 'read_note',
    label: '读取验证资料',
    description: '读取验证资料文件，返回其中的唯一标记。',
    parameters: Type.Object({}),
    outputSchema: Type.Object({ marker: Type.String() }),
    async execute(_id, _args, signal, _update, ctx) {
      signal?.throwIfAborted();
      const id = ctx.sessionManager.getSessionId();
      executions.set(id, (executions.get(id) ?? 0) + 1);
      const marker = await readFile(join(cwd, 'evidence.txt'), 'utf8');
      return { content: [{ type: 'text', text: marker }], details: {}, structuredContent: { marker } };
    }
  });
  const parent = defineTool({
    name: 'inspect_note',
    label: '嵌套检查资料',
    description: '通过嵌套调用读取验证资料，返回文件中的唯一标记。',
    parameters: Type.Object({}),
    async execute(_id, args, _signal, _update, ctx) {
      const outcome = await ctx.executeTool('read_note', args);
      return { ...outcome.result, isError: outcome.isError };
    }
  });
  const toolAccess = {
    tools: [read, parent],
    async authorize(request) {
      requests.push({ sessionId: request.sessionId, toolName: request.toolName });
      const gate = gates.get(request.sessionId);
      if (gate) {
        entered.get(request.sessionId)?.resolve();
        return gate.promise;
      }
      return deny ? { allow: false, reason: '验证中的授权已撤销' } : { allow: true };
    }
  };
  function watch(session) {
    session.setThinkingLevel('off');
    subscriptions.push(
      session.subscribe(event => {
        if (event.type === 'agent_settled') endings.set(session.sessionId, event.aborted);
      })
    );
  }
  function assertCompleted(session) {
    assert.equal(endings.get(session.sessionId), false);
    const last = session.messages.findLast(message => message.role === 'assistant');
    assert(last);
    assert.notEqual(last.stopReason, 'error');
    assert.notEqual(last.stopReason, 'aborted');
    return last;
  }
  function assertMarker(session, marker) {
    const last = assertCompleted(session);
    assert(
      last.content.some(block => block.type === 'text' && block.text.includes(marker)),
      '真实模型没有返回实际工具结果'
    );
  }
  async function run() {
    if (phase === 'host-resume') {
      const saved = JSON.parse(await readFile(join(runDir, 'host-state.json'), 'utf8'));
      const cancelledFile = await readFile(saved.cancelledFile, 'utf8');
      const { session } = await pool.openSession({ ...input, file: saved.file });
      watch(session);
      assert.equal(session.sessionId, saved.sessionId);
      assert.equal(session.getSessionStats().userMessages, 3);
      assert(
        session.messages.some(
          message =>
            message.role === 'toolResult' &&
            message.nestedCalls?.calls.some(call => call.name === 'read_note' && call.status === 'ok')
        ),
        '嵌套调用记录没有原生恢复'
      );
      await session.prompt('前面验证资料文件中的唯一标记是什么？只回复那个完整标记，不要调用工具。');
      assertMarker(session, saved.marker);
      assert.equal(await readFile(saved.cancelledFile, 'utf8'), cancelledFile, '恢复另一 Agent 不应改写被取消会话');
      return {
        phase,
        ok: true,
        pid: process.pid,
        platform: process.platform,
        node: process.version,
        electron: process.versions.electron,
        processType: process.type ?? 'node',
        sessionId: session.sessionId,
        userMessages: session.getSessionStats().userMessages,
        assistantMessages: session.getSessionStats().assistantMessages,
        tokens: session.getSessionStats().tokens
      };
    }
    assert.equal(phase, 'host-tools');
    const marker = 'host-' + randomUUID();
    await writeFile(join(cwd, 'evidence.txt'), marker);
    const [{ session: first }, { session: second }] = await Promise.all([
      pool.createSession({ ...input, toolAccess }),
      pool.createSession({ ...input, toolAccess })
    ]);
    watch(first);
    watch(second);
    for (const session of [first, second]) {
      assert.equal(session.settingsManager.getCacheWarmingMode(), 'off');
      assert.equal(pool.get(session.sessionId), session);
      gates.set(session.sessionId, deferred());
      entered.set(session.sessionId, deferred());
    }
    assert.notEqual(first.sessionId, second.sessionId);
    const firstRun = first.prompt('调用 read_note 读取验证资料，然后仅回复工具返回的完整标记。');
    const secondRun = second.prompt(
      '调用 inspect_note 检查验证资料，不直接调用 read_note。然后仅回复工具返回的完整标记。'
    );
    // 立即附上异常处理，等待两次真实模型都到达工具授权边界。
    const runs = Promise.all([firstRun, secondRun]);
    void runs.catch(() => {});
    await Promise.all([entered.get(first.sessionId).promise, entered.get(second.sessionId).promise]);
    await pool.close(first.sessionId);
    await firstRun;
    assert.equal(endings.get(first.sessionId), true);
    assert.equal(executions.get(first.sessionId) ?? 0, 0);
    assert.equal(pool.get(first.sessionId), undefined);
    assert.equal(pool.get(second.sessionId), second);
    assert.equal(second.isStreaming, true, '另一个 Agent 应仍在等待自己的授权');
    const firstGate = gates.get(first.sessionId);
    const secondGate = gates.get(second.sessionId);
    gates.clear();
    firstGate.resolve({ allow: true });
    secondGate.resolve({ allow: true });
    await runs;
    assertMarker(second, marker);
    assert.equal(executions.get(first.sessionId) ?? 0, 0, '迟到的批准不得恢复已取消工具');
    assert.equal(executions.get(second.sessionId), 1);
    assert(
      second.messages.some(
        message =>
          message.role === 'toolResult' &&
          message.toolName === 'inspect_note' &&
          message.nestedCalls?.calls.some(call => call.name === 'read_note' && call.status === 'ok')
      )
    );
    await second.prompt('现在只调用 read_note 一次，读取资料并回复工具返回的完整标记。');
    assertMarker(second, marker);
    assert.equal(executions.get(second.sessionId), 2);
    deny = true;
    const before = second.messages.length;
    await second.prompt('这次仍尝试调用 read_note 一次。如果授权被拒绝，说明失败即可，不要重试。');
    assertCompleted(second);
    assert(
      second.messages
        .slice(before)
        .some(message => message.role === 'toolResult' && message.toolName === 'read_note' && message.isError)
    );
    assert.equal(executions.get(second.sessionId), 2, '撤权后不得再次读取');
    const file = second.sessionManager.getSessionFile();
    const cancelledFile = first.sessionManager.getSessionFile();
    await writeFile(
      join(runDir, 'host-state.json'),
      JSON.stringify({ sessionId: second.sessionId, file, cancelledFile, marker })
    );
    return {
      phase,
      ok: true,
      pid: process.pid,
      platform: process.platform,
      node: process.version,
      electron: process.versions.electron,
      processType: process.type ?? 'node',
      sessionId: second.sessionId,
      userMessages: second.getSessionStats().userMessages,
      assistantMessages: second.getSessionStats().assistantMessages,
      cancelledSession: first.sessionId,
      cancelledToolExecutions: executions.get(first.sessionId) ?? 0,
      successfulReads: executions.get(second.sessionId),
      authorizationChecks: requests.length,
      tokens: second.getSessionStats().tokens
    };
  }
  try {
    return await Promise.race([run(), deadline]);
  } finally {
    clearTimeout(timer);
    await pool.dispose();
    for (const unsubscribe of subscriptions) unsubscribe();
  }
}
