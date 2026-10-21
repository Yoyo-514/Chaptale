import { createHostApplication } from '@chaptale/agent-host/application';
import { CreationApplication } from '@chaptale/creation/application';
import { openCreationStorage } from '@chaptale/storage';

import type { ApplicationBootstrapOptions, ApplicationPacket, ApplicationRequest } from './protocol.ts';

// ParentPort 是 Electron 进程 IPC；消息与 DOM Window.postMessage 无关。
const parent = process.parentPort!;
function send(packet: ApplicationPacket) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parent.postMessage(packet);
}

async function start() {
  let creation: CreationApplication | undefined;
  try {
    const options = JSON.parse(process.argv[2]) as ApplicationBootstrapOptions;
    creation = new CreationApplication(await openCreationStorage({ rootDir: options.creationDir }));
    const author = creation;
    const agent = await createHostApplication(options.agent);
    agent.subscribe(event => send({ type: 'agent', packet: { type: 'event', event } }));
    author.subscribe(event => send({ type: 'creation', packet: { type: 'event', event } }));
    parent.on('message', ({ data }: { data: ApplicationRequest }) => {
      switch (data.type) {
        case 'shutdown':
          void agent
            .dispose()
            .finally(() => author.close())
            .then(
              () => process.exit(0),
              () => process.exit(1)
            );
          break;
        case 'creation':
          // 作者身份由主进程通道绑定，命令中的业务参数由作品入口校验。
          send({
            type: 'creation',
            packet: {
              type: 'reply',
              reply: {
                id: data.request.id,
                ok: true,
                value: author.executeAuthor(data.request.command)
              }
            }
          });
          break;
        case 'agent':
          void agent.execute(data.request.command).then(
            value =>
              send({ type: 'agent', packet: { type: 'reply', reply: { id: data.request.id, ok: true, value } } }),
            error =>
              send({
                type: 'agent',
                packet: {
                  type: 'reply',
                  reply: {
                    id: data.request.id,
                    ok: false,
                    error: error instanceof Error ? error.message : 'Agent 请求失败'
                  }
                }
              })
          );
          break;
      }
    });
    send({ type: 'ready' });
  } catch {
    creation?.close();
    send({ type: 'failed', error: '应用宿主启动失败，请检查本机配置、作品库与目录权限' });
    process.exit(1);
  }
}

void start();
