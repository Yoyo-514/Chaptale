import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execute = promisify(execFile);
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const tempRoot = join(workspace, 'temp');
const script = fileURLToPath(import.meta.url);
let outputDirectory;

async function ignoredPath(pathname) {
  const actual = await realpath(pathname);
  const inside = relative(await realpath(tempRoot), actual);
  assert(
    inside && inside !== '..' && !inside.startsWith('..' + sep) && !isAbsolute(inside),
    '路径必须位于仓库 temp 内'
  );
  await execute('git', ['check-ignore', '--quiet', actual], { cwd: workspace, windowsHide: true });
  return actual;
}

// 子进程只继承启动 Node 必需的系统环境，不继承开发机模型凭据、代理或 NODE_OPTIONS。
function childEnvironment(home) {
  const allowed = new Set(['path', 'pathext', 'comspec', 'systemroot', 'windir', 'temp', 'tmp']);
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => allowed.has(key.toLowerCase())));
  return {
    ...env,
    HOME: home,
    USERPROFILE: home,
    XDG_CONFIG_HOME: home,
    XDG_CACHE_HOME: home,
    TEMP: home,
    TMP: home,
    TMPDIR: home
  };
}

async function verifyChild(runDir, phase) {
  if (phase.startsWith('host-')) {
    const { verifyHostPhase } = await import('./verify-live-host.mjs');
    const result = await verifyHostPhase(runDir, phase);
    if (process.type === 'utility') {
      // Electron ParentPort 是进程 IPC，不是需要 targetOrigin 的 Window.postMessage。
      process.parentPort.postMessage({ type: 'host-verified', result });
    } else console.log(JSON.stringify(result));
    return;
  }
  // 动态导入发生在隔离环境的子进程中；不使用终端 CLI 或真实全局 pi 目录。
  const { SessionManager } = await import('@earendil-works/pi-coding-agent');
  const { createHostModelRuntime, createHostSession, openHostSessionManager } = await import('../src/index.ts');
  const model = JSON.parse(await readFile(join(runDir, 'selection.json'), 'utf8'));
  const cwd = join(runDir, 'work');
  const manager =
    phase === 'resume'
      ? await openHostSessionManager({
          file: await ignoredPath(JSON.parse(await readFile(join(runDir, 'session.json'), 'utf8')).file),
          cwd
        })
      : SessionManager.create(cwd, join(runDir, 'sessions'));
  const runtime = await createHostModelRuntime({ configDir: join(runDir, 'config') });
  const { session } = await createHostSession({
    cwd,
    agentDir: join(runDir, 'agent'),
    modelRuntime: runtime,
    sessionManager: manager,
    model,
    systemPrompt: '你是连接测试助手。请精确回答用户的问题，不调用工具，保持简短。'
  });
  session.setThinkingLevel('off');
  let textDeltas = 0;
  let progressDeltas = 0;
  let abortRequest;
  let timedOut = false;
  let complete;
  const settled = new Promise(resolveSettled => {
    complete = resolveSettled;
  });
  const unsubscribe = session.subscribe(event => {
    if (event.type === 'message_update') {
      const type = event.assistantMessageEvent.type;
      if (type === 'text_delta') textDeltas++;
      // 取消必须能发生在推理阶段，不能要求模型先产生正文。
      if (type === 'text_delta' || type === 'thinking_delta') {
        progressDeltas++;
        if (phase === 'cancel' && !abortRequest) abortRequest = session.abort();
      }
    }
    if (event.type === 'agent_settled') complete(event);
  });
  const timer = setTimeout(() => {
    timedOut = true;
    abortRequest ??= session.abort();
  }, 45_000);
  try {
    assert.equal(session.settingsManager.getCacheWarmingMode(), 'off');
    assert.deepEqual(session.getActiveToolNames(), []);
    if (phase === 'resume') assert.equal(session.getSessionStats().assistantMessages, 1);
    const prompt =
      phase === 'resume'
        ? '刚才要求你回复的四个汉字是什么？只回复这四个字。'
        : phase === 'cancel'
          ? '从 1 到 5000 依次逐行列出所有整数，不要省略。'
          : '请只回复“连接成功”，不加标点。';
    await session.prompt(prompt);
    const ending = await settled;
    await abortRequest;
    assert.equal(timedOut, false, '模型请求超过宿主期限');
    const assistant = session.state.messages.findLast(message => message.role === 'assistant');
    assert(assistant, '缺少模型返回');
    assert(progressDeltas > 0, '没有收到模型增量');
    assert.equal(ending.aborted, phase === 'cancel');
    if (phase === 'cancel') {
      assert(abortRequest, '未触发流中取消');
      assert.equal(assistant.stopReason, 'aborted');
    } else {
      assert(textDeltas > 0, '没有收到文本增量');
      assert.notEqual(assistant.stopReason, 'error');
      assert.notEqual(assistant.stopReason, 'aborted');
      assert(
        assistant.content.some(block => block.type === 'text' && block.text.includes('连接成功')),
        '真实模型输出未满足验收'
      );
    }
    assert.equal(typeof assistant.durationMs, 'number');
    assert(assistant.durationMs >= 0);
    const stats = session.getSessionStats();
    if (phase === 'create')
      await writeFile(join(runDir, 'session.json'), JSON.stringify({ file: manager.getSessionFile() }));
    console.log(
      JSON.stringify({
        phase,
        ok: true,
        pid: process.pid,
        sessionId: session.sessionId,
        userMessages: stats.userMessages,
        assistantMessages: stats.assistantMessages,
        textDeltas,
        progressDeltas,
        aborted: ending.aborted,
        stopReason: assistant.stopReason,
        durationMs: assistant.durationMs,
        tokens: stats.tokens
      })
    );
  } finally {
    clearTimeout(timer);
    unsubscribe();
    await session.abort();
    session.dispose();
  }
}

async function verifyLive() {
  const electron = process.argv[2] === '--electron-host';
  const host = electron || process.argv[2] === '--host';
  const [configArgument, providerArgument, modelArgument] = process.argv.slice(host ? 3 : 2);
  assert(configArgument, '用法：test:live <temp 内的配置文件> [provider modelId]');
  const source = await ignoredPath(resolve(configArgument));
  const config = JSON.parse(await readFile(source, 'utf8'));
  const providers = config.providers ?? config;
  const candidates = Object.entries(providers).flatMap(([provider, definition]) =>
    (definition.models ?? []).map(model => ({ provider, definition, model }))
  );
  const selected =
    providerArgument && modelArgument
      ? candidates.find(item => item.provider === providerArgument && item.model.id === modelArgument)
      : candidates.length === 1
        ? candidates[0]
        : undefined;
  assert(selected, '多模型配置需要显式 provider 和 modelId，且该模型必须存在');
  const { provider, definition, model } = selected;
  assert.equal(typeof definition.apiKey, 'string', '测试配置必须提供明确的 API key');
  assert(definition.apiKey.trim() && !definition.apiKey.startsWith('!'), '不接受空凭据或凭据命令');
  assert.equal(typeof definition.baseUrl, 'string');
  const runDir = await mkdtemp(join(tempRoot, 'pi-live-'));
  await ignoredPath(runDir);
  outputDirectory = runDir;
  for (const directory of ['config', 'agent', 'work', 'sessions', 'home']) await mkdir(join(runDir, directory));
  const { apiKey, ...providerConfig } = definition;
  await writeFile(
    join(runDir, 'config', 'auth.json'),
    JSON.stringify({ [provider]: { type: 'api_key', key: apiKey } })
  );
  await writeFile(
    join(runDir, 'config', 'models.json'),
    JSON.stringify({
      providers: {
        [provider]: {
          ...providerConfig,
          models: [{ ...model, maxTokens: Math.min(model.maxTokens ?? (host ? 1024 : 512), host ? 1024 : 512) }]
        }
      }
    })
  );
  await writeFile(join(runDir, 'selection.json'), JSON.stringify({ provider, id: model.id }));
  const desktopRequire = electron ? createRequire(join(workspace, 'apps/desktop/package.json')) : undefined;
  const executable = desktopRequire ? desktopRequire('electron') : process.execPath;
  const electronVersion = desktopRequire?.('electron/package.json').version;
  const entry = electron ? fileURLToPath(new URL('./verify-electron-host.mjs', import.meta.url)) : script;
  const results = [];
  for (const phase of host ? ['host-tools', 'host-resume'] : ['create', 'resume', 'cancel']) {
    let result;
    try {
      const args = electron ? [entry, runDir, phase] : [entry, '--child', runDir, phase];
      result = await execute(executable, args, {
        cwd: workspace,
        env: childEnvironment(join(runDir, 'home')),
        windowsHide: true,
        timeout: host ? 180_000 : 65_000,
        maxBuffer: 2 * 1024 * 1024
      });
      await writeFile(join(runDir, phase + '.log'), result.stdout + result.stderr);
      const observed = JSON.parse(result.stdout.trim().split('\n').at(-1));
      if (electron) {
        assert.equal(observed.electron, electronVersion);
        assert.equal(observed.processType, 'utility');
        assert.equal(observed.shutdown, 'parent-after-dispose');
      }
      results.push(observed);
    } catch (error) {
      // 原始 SDK 诊断可能含请求细节，只存入已确认忽略的目录，不回显到终端。
      await writeFile(
        join(runDir, phase + '.log'),
        String(error.stdout ?? result?.stdout ?? '') +
          String(error.stderr ?? result?.stderr ?? '') +
          '\n' +
          String(error)
      );
      // 原始错误仅保留在上述忽略目录，不能通过 cause 传播到终端。
      // oxlint-disable-next-line eslint/preserve-caught-error
      throw new Error('真实验证失败：' + phase + '；诊断保留于 ' + runDir);
    }
  }
  assert.equal(results[0].sessionId, results[1].sessionId);
  assert.notEqual(results[0].pid, results[1].pid);
  assert.equal(results[1].userMessages, results[0].userMessages + 1);
  assert.equal(results[1].assistantMessages, results[0].assistantMessages + 1);
  await writeFile(join(runDir, 'result.json'), JSON.stringify({ api: definition.api, results }, null, 2));
  console.log(JSON.stringify({ ok: true, outputDirectory: runDir, results }, null, 2));
}

try {
  if (process.argv[2] === '--child') await verifyChild(await ignoredPath(process.argv[3]), process.argv[4]);
  else await verifyLive();
} catch (error) {
  if (process.argv[2] === '--child') console.error(error);
  else
    console.error(
      JSON.stringify({ ok: false, outputDirectory, error: '真实模型验证未通过；请检查配置或 temp 内的诊断记录。' })
    );
  process.exitCode = 1;
  if (process.type === 'utility') {
    // Electron ParentPort 没有 targetOrigin 参数。
    process.parentPort.postMessage({ type: 'host-verification-failed' });
  }
}
