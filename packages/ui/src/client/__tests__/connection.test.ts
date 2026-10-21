import { MessageChannel } from 'node:worker_threads';
import { afterEach, expect, it } from 'vitest';

import type { RpcRequest } from '@chaptale/contracts';

import { RpcConnection } from '../connection.ts';

type Commands = {
  create: { input: { title: string }; output: string };
  history: { input: undefined; output: string[] };
  prompt: { input: { id: string; text: string }; output: void };
  state: { input: undefined; output: void };
};
type Event = { kind: 'closed'; id: string; cursor: number };
const cleanup: (() => void)[] = [];
afterEach(() => cleanup.splice(0).forEach(close => close()));

function connection() {
  const { port1, port2 } = new MessageChannel();
  const client = new RpcConnection<Commands, Event>(request => port1.postMessage(request));
  port1.on('message', packet => client.receive(packet));
  cleanup.push(() => {
    client.disconnect(new Error('测试结束'));
    port1.close();
    port2.close();
  });
  return { client, server: port2 };
}

it('并发请求按 id 匹配，乱序回复互不串用，事件不消耗请求', async () => {
  const { client, server } = connection();
  const requests: RpcRequest<Commands>[] = [];
  const events: number[] = [];
  client.subscribe(event => events.push(event.cursor));
  server.on('message', (request: RpcRequest<Commands>) => {
    requests.push(request);
    if (requests.length === 2) {
      server.postMessage({ type: 'event', event: { kind: 'closed', id: 'old-session', cursor: 1 } });
      server.postMessage({ type: 'reply', reply: { id: requests[1].id, ok: true, value: [] } });
      server.postMessage({ type: 'reply', reply: { id: requests[0].id, ok: true, value: 'new-session' } });
    }
  });
  const created = client.request('create', { title: '新会话' });
  const history = client.request('history', undefined);
  expect(await history).toEqual([]);
  expect(await created).toBe('new-session');
  expect(events).toEqual([1]);
  expect(requests[0].id).not.toBe(requests[1].id);
});

it('断开时拒绝未完成请求，迟到回复不恢复请求，断开后不重发', async () => {
  const { client, server } = connection();
  const received: RpcRequest<Commands>[] = [];
  server.on('message', (request: RpcRequest<Commands>) => received.push(request));
  const pending = client.request('prompt', { id: 'session', text: '写一段' });
  const failure = expect(pending).rejects.toThrow('宿主退出');
  await new Promise<void>(resolve => server.once('message', () => resolve()));
  client.disconnect(new Error('宿主退出'));
  await failure;
  await expect(client.request('state', undefined)).rejects.toThrow('宿主退出');
  client.receive({ type: 'reply', reply: { id: received[0].id, ok: true, value: undefined } });
  expect(received).toHaveLength(1);
});

it('宿主业务错误按对应请求返回', async () => {
  const { client, server } = connection();
  server.on('message', (request: RpcRequest<Commands>) => {
    server.postMessage({ type: 'reply', reply: { id: request.id, ok: false, error: '该会话为只读历史' } });
  });
  await expect(client.request('prompt', { id: 'readonly', text: '继续' })).rejects.toThrow('该会话为只读历史');
});
