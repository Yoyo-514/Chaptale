// 打包产物启动检查：用临时用户目录启动解包后的应用，等应用宿主建好作品库且进程仍在运行，再结束进程。
import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const release = path.resolve(process.argv[2] ?? 'apps/desktop/release');
const timeoutMs = 60_000;

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

const home = mkdtempSync(path.join(tmpdir(), 'chaptale-smoke-'));
mkdirSync(path.join(home, '.chaptale'));
writeFileSync(path.join(home, '.chaptale/settings.json'), JSON.stringify({ version: 1, workspace: {} }));
const library = path.join(home, '.chaptale/creation/library.sqlite');
const args = [`--user-data-dir=${path.join(home, 'profile')}`];
if (process.platform === 'linux') args.push('--no-sandbox');
const child = spawn(executable(), args, {
  env: { ...process.env, HOME: home, USERPROFILE: home, NODE_ENV: 'production' },
  stdio: 'inherit'
});
let exited = null;
child.on('exit', code => (exited = code ?? 'signal'));

const started = Date.now();
try {
  while (!existsSync(library)) {
    if (exited !== null) throw new Error(`应用在建立作品库前退出（${exited}）`);
    if (Date.now() - started > timeoutMs) throw new Error('等待作品库建立超时');
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  // 作品库建好后再观察片刻，确认宿主没有随即崩溃。
  await new Promise(resolve => setTimeout(resolve, 3000));
  if (exited !== null) throw new Error(`应用建立作品库后退出（${exited}）`);
  console.log('打包产物启动检查通过');
} finally {
  if (exited === null) child.kill();
  await new Promise(resolve => setTimeout(resolve, 1000));
  rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 });
}
