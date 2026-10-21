import { createHostApplication, type HostBootstrapOptions } from '@chaptale/agent-host/application';
import type { HostRequest, HostPacket } from '@chaptale/agent-host/protocol';

// ParentPort 是 Electron 进程 IPC；消息与 DOM Window.postMessage 无关。
const parent = process.parentPort!;
function send(packet: HostPacket | { type: 'ready' } | { type: 'failed'; error: string }) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parent.postMessage(packet);
}

async function start() {
  try {
    const options = JSON.parse(process.argv[2]) as HostBootstrapOptions;
    const application = await createHostApplication(options);
    application.subscribe(event => send({ type: 'event', event }));
    parent.on('message', ({ data }: { data: HostRequest | { type: 'shutdown' } }) => {
      if ('type' in data) {
        void application.dispose().then(
          () => process.exit(0),
          () => process.exit(1)
        );
        return;
      }
      void application.execute(data.command).then(
        value => send({ type: 'reply', reply: { id: data.id, ok: true, value } }),
        error =>
          send({
            type: 'reply',
            reply: { id: data.id, ok: false, error: error instanceof Error ? error.message : 'Agent 请求失败' }
          })
      );
    });
    send({ type: 'ready' });
  } catch {
    send({ type: 'failed', error: 'Agent 宿主启动失败，请检查本机 Agent 配置与目录权限' });
    process.exit(1);
  }
}

void start();
