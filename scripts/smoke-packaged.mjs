// 打包产物启动检查：用临时用户目录启动解包后的应用，等应用宿主建好作品库且进程仍在运行，再结束进程。
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const release = path.resolve(process.argv[2] ?? 'apps/desktop/release');
const startupTimeoutMs = 60_000;
const exitTimeoutMs = 3_000;

function executable() {
  for (const dir of readdirSync(release)) {
    const root = path.join(release, dir);
    if (process.platform === 'win32' && dir === 'win-unpacked') return path.join(root, 'Chaptale.exe');
    if (process.platform === 'linux' && dir === 'linux-unpacked') return path.join(root, 'chaptale');
    if (process.platform === 'darwin' && dir.startsWith('mac') && existsSync(path.join(root, 'Chaptale.app')))
      return path.join(root, 'Chaptale.app/Contents/MacOS/Chaptale');
  }
  throw new Error(`${release} 中没有当前平台的解包产物`);
}

const executablePath = executable();
const home = mkdtempSync(path.join(tmpdir(), 'chaptale-smoke-'));
const configDir = path.join(home, '.chaptale');
const dataDir = path.join(configDir, 'data');
// 预先选好空的数据目录，让解包产物直接启动宿主而不是停在位置选择页。
mkdirSync(dataDir, { recursive: true });
writeFileSync(
  path.join(configDir, 'settings.json'),
  JSON.stringify({ version: 1, dataDir, checkUpdatesOnStartup: false })
);
const library = path.join(dataDir, 'library.sqlite');
const args = [`--user-data-dir=${path.join(home, 'profile')}`];
if (process.platform === 'linux') args.push('--no-sandbox');
const hasProcessGroup = process.platform !== 'win32';
const child = spawn(executablePath, args, {
  env: { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' },
  detached: hasProcessGroup,
  stdio: 'inherit'
});
let exited = null;
const exit = new Promise(resolve => {
  child.once('exit', (code, signal) => {
    exited = code ?? signal;
    resolve();
  });
});

function sendSignal(signal) {
  if (!hasProcessGroup) {
    child.kill(signal);
    return;
  }
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    // 进程可能在发送信号前已经退出。
    if (error.code !== 'ESRCH') throw error;
  }
}

function waitForExit() {
  return Promise.race([exit, delay(exitTimeoutMs, undefined, { ref: false })]);
}

async function stopApplication() {
  if (child.pid === undefined) return;
  try {
    if (exited === null) {
      sendSignal('SIGTERM');
      await waitForExit();
    }
    // 单独的进程组也包含 Electron Helper，主进程退出后仍可能有残留。
    if (hasProcessGroup || exited === null) sendSignal('SIGKILL');
    await waitForExit();
    if (exited === null) throw new Error(`打包产物强制终止后仍未退出，进程 ID：${child.pid}`);
  } finally {
    child.unref();
  }
}

try {
  await once(child, 'spawn');
  const started = Date.now();
  while (!existsSync(library)) {
    if (exited !== null) throw new Error(`应用在建立作品库前退出（${exited}）`);
    if (Date.now() - started > startupTimeoutMs) throw new Error('等待作品库建立超时');
    await delay(500);
  }
  // 作品库建好后再观察片刻，确认宿主没有随即崩溃。
  await delay(3000);
  if (exited !== null) throw new Error(`应用建立作品库后退出（${exited}）`);
} finally {
  await stopApplication();
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
console.log('打包产物启动检查通过');
