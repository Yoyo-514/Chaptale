import { app, utilityProcess } from 'electron';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

// 只承载验证：不打开窗口、不加载生产配置、不以 ELECTRON_RUN_AS_NODE 代替 utilityProcess。
const [runDir, phase] = process.argv.slice(2);
assert(runDir && ['host-tools', 'host-resume'].includes(phase));
app.setPath('userData', join(runDir, 'electron-user-data'));
app.disableHardwareAcceleration();

// 不在入口模块顶层等待 ready；Electron 会等待 ESM 入口装载完成后才触发它。
async function run() {
  await app.whenReady();
  const child = utilityProcess.fork(
    fileURLToPath(new URL('./verify-live-session.mjs', import.meta.url)),
    ['--child', runDir, phase],
    {
      cwd: fileURLToPath(new URL('../../../', import.meta.url)),
      serviceName: 'Chaptale pi host validation',
      stdio: 'pipe'
    }
  );
  child.stdout.pipe(process.stdout);
  child.stderr.pipe(process.stderr);
  let result;
  const timer = setTimeout(() => {
    console.error('Electron utilityProcess 超过退出期限');
    child.kill();
    app.exit(1);
  }, 170_000);
  child.once('message', message => {
    if (message.type === 'host-verified' && message.result?.ok === true) result = message.result;
    // 原生 utilityProcess 即使没有活跃 JS 资源仍会常驻；完成消息只在池释放后发送。
    child.kill();
  });
  child.once('exit', code => {
    clearTimeout(timer);
    if (result && code === 0) {
      console.log(JSON.stringify({ ...result, shutdown: 'parent-after-dispose' }));
      app.exit(0);
    } else app.exit(1);
  });
}

void run().catch(error => {
  console.error(error);
  app.exit(1);
});
