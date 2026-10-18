import {
  defineTool,
  createReadToolDefinition,
  createLsToolDefinition,
  createFindToolDefinition,
  createGrepToolDefinition
} from '@earendil-works/pi-coding-agent';
import { mkdir } from 'node:fs/promises';

import { builtinWritingInstructions, createHostModelRuntime, HostModelConfiguration } from '@chaptale/agent-host';
import { HostApplication } from '@chaptale/agent-host/application';
import type { HostRequest, HostPacket } from '@chaptale/agent-host/protocol';

import type { AgentProcessOptions } from './process';

// ParentPort 是 Electron 进程 IPC；消息与 DOM Window.postMessage 无关。
const parent = process.parentPort!;
function send(packet: HostPacket | { type: 'ready' } | { type: 'failed'; error: string }) {
  // oxlint-disable-next-line unicorn/require-post-message-target-origin
  parent.postMessage(packet);
}

async function start() {
  try {
    const options = JSON.parse(process.argv[2]) as AgentProcessOptions;
    await Promise.all(
      [options.configDir, options.agentDir, options.sessionDir, options.cwd].map(directory =>
        mkdir(directory, { recursive: true })
      )
    );
    const runtime = await createHostModelRuntime({ configDir: options.configDir });
    const application = await HostApplication.create({
      ...options,
      builtinInstructions: builtinWritingInstructions,
      modelRuntime: runtime,
      modelConfiguration: new HostModelConfiguration(options.configDir, runtime),
      // 作品写入随创作工具接入。只读工具仍逐次经过 HostApplication 的授权边界。
      tools: cwd => [
        defineTool(createReadToolDefinition(cwd)),
        defineTool(createLsToolDefinition(cwd)),
        defineTool(createFindToolDefinition(cwd)),
        defineTool(createGrepToolDefinition(cwd))
      ]
    });
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
