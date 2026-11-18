import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { EmbeddingSettingsSave, HostEvent, VectorIndexStatus } from '@chaptale/agent-host/protocol';

import { defaultWidth, startEmbeddingServer } from './embedding-server.ts';
import {
  creation,
  documentId,
  host,
  revisionId,
  root,
  setupWorkSession,
  value,
  workId
} from './work-session-fixture.ts';

setupWorkSession();

let server: Awaited<ReturnType<typeof startEmbeddingServer>>;
let events: VectorIndexStatus[];
beforeEach(async () => {
  server = await startEmbeddingServer();
  events = [];
  host.subscribe((event: HostEvent) => {
    if (event.kind === 'vector-index') events.push(event.status);
  });
});
afterEach(() => server.close());

function settings(change: Partial<EmbeddingSettingsSave> = {}): EmbeddingSettingsSave {
  return { baseUrl: server.baseUrl, model: 'Qwen/Qwen3-Embedding-8B', dimensions: null, ...change };
}
const save = (change?: Partial<EmbeddingSettingsSave>) =>
  host.execute({ method: 'saveEmbeddingSettings', input: settings({ apiKey: 'sk-local', ...change }) });
const status = () => host.execute({ method: 'vectorIndex', input: { workId } }) as Promise<VectorIndexStatus>;
/** 启动建立；events 从这次建立重新记起。 */
function build(rebuild = false) {
  events.length = 0;
  return host.execute({ method: 'buildVectorIndex', input: { workId, rebuild } }) as Promise<VectorIndexStatus>;
}

/** 等这部作品的建立结束，返回结束时的状态。 */
async function finished(): Promise<VectorIndexStatus> {
  return vi.waitFor(() => {
    const last = events.at(-1);
    expect(last?.running).toBeNull();
    return last!;
  });
}

/** 夹具里已有序章一段；再添 count 篇各一段的文稿。 */
function chapters(count: number) {
  for (let index = 1; index <= count; index++)
    value(
      creation.executeAuthor({
        method: 'createEntry',
        input: {
          commandId: randomUUID(),
          workId,
          parentId: null,
          section: 'manuscript',
          kind: 'document',
          title: `第${index}回`,
          format: 'txt',
          content: `这是第${index}回的正文。`
        }
      })
    );
}

it('检索服务设置保存后不回显密钥，留空密钥时沿用已保存的', async () => {
  expect(await host.execute({ method: 'embeddingSettings', input: undefined })).toBeNull();
  expect(await status()).toMatchObject({ state: 'unconfigured', total: 1, indexed: 0 });

  const view = { baseUrl: server.baseUrl, model: 'Qwen/Qwen3-Embedding-8B', dimensions: null, hasApiKey: true };
  expect(await save()).toEqual(view);
  expect(await host.execute({ method: 'embeddingSettings', input: undefined })).toEqual(view);
  expect(JSON.parse(await readFile(join(root, 'config', 'embedding.json'), 'utf8'))).toMatchObject({
    apiKey: 'sk-local'
  });

  expect(await save({ apiKey: undefined, model: ' BAAI/bge-m3 ', dimensions: 4 })).toEqual({
    ...view,
    model: 'BAAI/bge-m3',
    dimensions: 4
  });
  await host.execute({ method: 'testEmbedding', input: settings() });
  expect(server.requests.at(-1)?.authorization).toBe('Bearer sk-local');

  for (const [change, message] of [
    [{ baseUrl: 'ftp://example.com' }, '服务地址必须为有效的 HTTP 或 HTTPS 地址'],
    [{ model: '  ' }, '模型名不能为空'],
    [{ dimensions: 0 }, '向量维度必须为正整数'],
    [{ dimensions: 1.5 }, '向量维度必须为正整数'],
    [{ apiKey: ' ' }, 'API 密钥必须为非空凭据文本']
  ] as const)
    await expect(save(change)).rejects.toThrow(message);
});

it('测试连接按表单里的设置发送一段短文字，返回服务给出的维度', async () => {
  // 还没有保存过设置也能测试。
  expect(await host.execute({ method: 'testEmbedding', input: settings({ apiKey: 'sk-form' }) })).toEqual({
    dimensions: defaultWidth
  });
  expect(server.requests).toEqual([
    { authorization: 'Bearer sk-form', model: 'Qwen/Qwen3-Embedding-8B', input: ['测试连接'], dimensions: undefined }
  ]);
  expect(await host.execute({ method: 'testEmbedding', input: settings({ dimensions: 4 }) })).toEqual({
    dimensions: 4
  });
  expect(server.requests.at(-1)).toMatchObject({ authorization: undefined, dimensions: 4 });
  expect(await host.execute({ method: 'embeddingSettings', input: undefined })).toBeNull();

  server.replyWith({ status: 401, body: { error: { message: 'Invalid token' } } });
  await expect(host.execute({ method: 'testEmbedding', input: settings() })).rejects.toThrow(
    '检索服务返回 HTTP 401：Invalid token'
  );
  // 服务忽略 dimensions 时返回的长度与设置不符。
  server.replyWith({ status: 200, body: { data: [{ index: 0, embedding: [0.1, 0.2] }] } });
  await expect(host.execute({ method: 'testEmbedding', input: settings({ dimensions: 4 }) })).rejects.toThrow(
    '检索服务返回 2 维向量，与设置的 4 维不一致'
  );
  server.replyWith({ status: 200, body: '<html>网关页面</html>' });
  await expect(host.execute({ method: 'testEmbedding', input: settings() })).rejects.toThrow('检索服务返回的不是 JSON');
  server.replyWith({ status: 200, body: { data: [] } });
  await expect(host.execute({ method: 'testEmbedding', input: settings() })).rejects.toThrow(
    '检索服务返回的向量与请求的文字对不上'
  );
  await expect(
    host.execute({ method: 'testEmbedding', input: settings({ baseUrl: 'http://127.0.0.1:9/v1' }) })
  ).rejects.toThrow('无法连接检索服务');
});

it('建立索引分批发送全部段落并报告进度；正文改动后只补算改过的段落', async () => {
  await save();
  chapters(12);
  expect(await status()).toMatchObject({ state: 'none', total: 13, indexed: 0, running: null });

  expect(await build()).toMatchObject({ state: 'ready', indexed: 0, running: { done: 0, total: 13 } });
  await expect(host.execute({ method: 'buildVectorIndex', input: { workId, rebuild: false } })).rejects.toThrow(
    '这部作品的向量索引正在建立'
  );
  const done = await finished();
  expect(done).toMatchObject({ state: 'ready', total: 13, indexed: 13, pendingCharacters: 0 });
  expect(done.error).toBeUndefined();
  expect(events.map(event => event.running)).toEqual([{ done: 10, total: 13 }, { done: 13, total: 13 }, null]);
  expect(events[0]).toMatchObject({ indexed: 10 });
  expect(server.requests.map(request => request.input.length)).toEqual([10, 3]);
  expect(server.requests[0]).toMatchObject({ authorization: 'Bearer sk-local', model: 'Qwen/Qwen3-Embedding-8B' });
  expect(server.requests[0]!.input[0]).toBe('序章\n将军守城。\n城外下雪。\n斥候回营。');
  expect(await status()).toEqual(done);

  // 没有要算的段落时不发请求。
  expect(await build()).toMatchObject({ indexed: 13, running: null });
  expect(server.requests).toHaveLength(2);

  value(
    creation.executeAuthor({
      method: 'saveDocument',
      input: {
        commandId: randomUUID(),
        workId,
        documentId,
        expectedRevisionId: revisionId,
        title: '序章',
        format: 'txt',
        content: '将军弃城。'
      }
    })
  );
  expect(await status()).toMatchObject({ state: 'ready', total: 13, indexed: 12 });
  await build();
  expect(await finished()).toMatchObject({ indexed: 13 });
  expect(server.requests.at(-1)?.input).toEqual(['序章\n将军弃城。']);
});

it('换了模型或维度后要重建才能使用', async () => {
  await save();
  await build();
  expect(await finished()).toMatchObject({ state: 'ready', indexed: 1 });

  await save({ dimensions: 4 });
  expect(await status()).toMatchObject({ state: 'stale', total: 1, indexed: 0 });
  await expect(build()).rejects.toThrow('索引用的是另一个模型或维度，需要重建');
  await build(true);
  expect(await finished()).toMatchObject({ state: 'ready', indexed: 1 });
  expect(server.requests.at(-1)).toMatchObject({ dimensions: 4 });

  // 同一个模型也可以重建，全部段落重新发送。
  chapters(1);
  await build(true);
  expect(await finished()).toMatchObject({ state: 'ready', total: 2, indexed: 2 });
  expect(server.requests.at(-1)?.input).toHaveLength(2);
});

it('建立失败时保留已算好的段落并给出原因，再次建立从剩下的接着算；服务繁忙时自动重试', async () => {
  await save();
  chapters(12);
  server.replyWith(
    { status: 429, body: { message: 'Rate limit' }, headers: { 'Retry-After': '0' } },
    { status: 503, body: 'busy', headers: { 'Retry-After': '0' } },
    'ok',
    { status: 400, body: { error: { message: 'input too long' } } }
  );
  await build();
  // 第一批重试两次后成功，第二批被服务拒绝。
  const failed = await finished();
  expect(server.requests.map(request => request.input.length)).toEqual([10, 10, 10, 3]);
  expect(failed).toMatchObject({
    state: 'ready',
    indexed: 10,
    running: null,
    error: '检索服务返回 HTTP 400：input too long'
  });
  expect(await status()).toEqual(failed);

  await build();
  const done = await finished();
  expect(done).toMatchObject({ indexed: 13 });
  expect(done.error).toBeUndefined();
  expect(server.requests.at(-1)?.input).toHaveLength(3);
});

it('取消建立保留已算好的段落，之后可以继续；保存检索设置会停止正在进行的建立', async () => {
  await save();
  chapters(12);
  let release = server.hold(1);
  await build();
  await vi.waitFor(() => expect(server.requests).toHaveLength(2));
  expect(await status()).toMatchObject({ indexed: 10, running: { done: 10, total: 13 } });
  const cancelled = (await host.execute({ method: 'cancelVectorIndex', input: { workId } })) as VectorIndexStatus;
  release();
  expect(cancelled).toMatchObject({ state: 'ready', indexed: 10, running: null });
  expect(cancelled.error).toBeUndefined();
  expect(events.at(-1)).toEqual(cancelled);

  release = server.hold();
  expect(await build()).toMatchObject({ running: { done: 0, total: 3 } });
  await vi.waitFor(() => expect(server.requests).toHaveLength(3));
  await save();
  release();
  expect(await status()).toMatchObject({ indexed: 10, running: null });
});

it('删除作品前停止建立，作品目录可以交给系统回收站', async () => {
  await save();
  chapters(12);
  const release = server.hold();
  await build();
  await vi.waitFor(() => expect(server.requests).toHaveLength(1));
  await host.execute({ method: 'trashWork', input: { commandId: randomUUID(), workId } });
  release();
  expect(events.at(-1)).toMatchObject({ indexed: 0, running: null });

  const { files } = (await host.execute({ method: 'purgeWork', input: { commandId: randomUUID(), workId } })) as {
    files: string[];
  };
  for (const file of files) await rm(file, { recursive: true });
  expect(existsSync(join(root, 'creation', 'works', workId))).toBe(false);
});

it('宿主停止时结束正在进行的建立', async () => {
  await save();
  chapters(12);
  const release = server.hold();
  await build();
  await vi.waitFor(() => expect(server.requests).toHaveLength(1));
  await host.dispose();
  release();
  // 停止后不再保存，也不再发下一批。
  await new Promise(resolve => setTimeout(resolve, 50));
  expect(server.requests).toHaveLength(1);
  expect(events).toEqual([]);
});
