import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

import type { HostEvent, VectorIndexStatus } from '@chaptale/agent-host/protocol';

import { startEmbeddingServer, vectorOf } from './embedding-server.ts';
import {
  call,
  creation,
  documentId,
  host,
  revisionId,
  setupWorkSession,
  value,
  workId
} from './work-session-fixture.ts';

setupWorkSession();

/** 维度取大一些，让不同文字的向量拉开差距。 */
const width = 64;
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

const save = () =>
  host.execute({
    method: 'saveEmbeddingSettings',
    input: { baseUrl: server.baseUrl, model: 'Qwen/Qwen3-Embedding-8B', dimensions: width }
  });
const status = () => host.execute({ method: 'vectorIndex', input: { workId } }) as Promise<VectorIndexStatus>;

/** 保存设置并为当前正式内容建好索引。 */
async function indexed() {
  await save();
  events.length = 0;
  await host.execute({ method: 'buildVectorIndex', input: { workId, rebuild: false } });
  if ((await status()).running) await vi.waitFor(() => expect(events.at(-1)?.running).toBeNull());
  expect(await status()).toMatchObject({ state: 'ready', pendingCharacters: 0 });
}

function author(title: string, content: string, section: 'manuscript' | 'resource' = 'manuscript') {
  return value(
    creation.executeAuthor({
      method: 'createEntry',
      input: {
        commandId: randomUUID(),
        workId,
        parentId: null,
        section,
        kind: 'document',
        title,
        format: 'txt',
        content
      }
    })
  );
}

interface Hit {
  kind: 'entry' | 'record' | 'relation';
  matchedBy: 'keyword' | 'semantic' | 'both';
  similarity?: number;
  entry?: { entryId: string };
  record?: { recordId: string };
  pending?: boolean;
  passages?: { startLine: number; endLine: number; text: string }[];
}
interface Page {
  hits: Hit[];
  hasMore: boolean;
  notice?: string;
}

async function search(input: Record<string, unknown>, sessionId?: string): Promise<Page> {
  const outcome = await call(
    'work_search',
    { workId, offset: 0, limit: 10, ...input },
    randomUUID(),
    undefined,
    sessionId
  );
  expect(outcome.isError).toBe(false);
  return outcome.result.structuredContent as unknown as Page;
}

const hitId = (hit: Hit) => hit.entry?.entryId ?? hit.record?.recordId;
/** 服务收到过的、含这段文字的那一段，与问题的余弦相似度。 */
function similarity(passage: string, question: string) {
  const text = server.requests.flatMap(request => request.input).find(input => input.includes(passage))!;
  const a = vectorOf(text, width);
  const b = vectorOf(question, width);
  return a.reduce((sum, component, index) => sum + component * b[index]!, 0);
}

it('没有设置检索服务或没有建立索引时只按关键词检索并说明原因', async () => {
  const question = '下雪天谁回了营地';
  expect(await search({ question })).toEqual({
    hits: [],
    hasMore: false,
    notice: '没有做语义检索：还没有设置检索服务。'
  });

  await save();
  const page = await search({ query: '守城', question });
  expect(page).toMatchObject({
    hits: [{ kind: 'entry', matchedBy: 'keyword', entry: { entryId: documentId } }],
    hasMore: false,
    notice: '没有做语义检索：这部作品还没有用当前的检索模型建立索引。'
  });
  expect(page.hits[0]).not.toHaveProperty('similarity');
  expect(server.requests).toHaveLength(0);

  // query 与 question 至少给一个。
  expect((await call('work_search', { workId, offset: 0, limit: 10 })).isError).toBe(true);
});

it('按意思检索返回最接近的段落、事件，标明来源与相似度；与关键词命中合并排名并分页，asOf 只到该章', async () => {
  const snow = author('雪夜', '大雪封山，驿路断绝。');
  const feast = author('春宴', '宫中设宴，百官朝贺。');
  const camp = author('归营', '信使连夜赶回大营。');
  const general = author('将军', '', 'resource');
  const order = value(
    creation.executeAuthor({
      method: 'createRecord',
      input: {
        commandId: randomUUID(),
        workId,
        resourceIds: [general.id],
        text: '将军下令开城。',
        source: { kind: 'author' },
        placement: { kind: 'chapter', chapterId: snow.id },
        storyTime: ''
      }
    })
  );
  await indexed();
  const built = server.requests.length;

  const question = '下雪天谁回了营地';
  const sources = [
    { id: documentId, passage: '将军守城。' },
    { id: snow.id, passage: '大雪封山' },
    { id: feast.id, passage: '宫中设宴' },
    { id: camp.id, passage: '信使连夜' },
    { id: order.id, passage: '将军下令开城。' }
  ]
    .map(source => ({ ...source, similarity: similarity(source.passage, question) }))
    .sort((a, b) => b.similarity - a.similarity);

  const page = await search({ question });
  expect(page.notice).toBeUndefined();
  expect(page.hasMore).toBe(false);
  expect(page.hits.map(hitId)).toEqual(sources.map(source => source.id));
  for (const [index, hit] of page.hits.entries()) {
    expect(hit.matchedBy).toBe('semantic');
    expect(hit.similarity).toBeCloseTo(sources[index]!.similarity, 2);
  }
  expect(page.hits.find(hit => hitId(hit) === camp.id)).toMatchObject({
    kind: 'entry',
    pending: false,
    passages: [{ startLine: 1, endLine: 1, text: '信使连夜赶回大营。' }]
  });
  expect(page.hits.find(hit => hitId(hit) === order.id)).toMatchObject({
    kind: 'record',
    record: { text: '将军下令开城。' }
  });
  // 段落的向量都已建好，检索只为问题发一次请求。
  expect(server.requests.slice(built).map(request => request.input)).toEqual([[question]]);

  // 序章是第一章：之后的章节和发生在其后的事件不参与。
  expect((await search({ question, asOf: documentId })).hits.map(hitId)).toEqual([documentId]);

  // “将军”按关键词命中序章正文、资料标题和事件；没有正文的资料没有向量，只来自关键词。
  const both = await search({ query: '将军', question });
  expect(Object.fromEntries(both.hits.map(hit => [hitId(hit), hit.matchedBy]))).toEqual({
    [documentId]: 'both',
    [order.id]: 'both',
    [general.id]: 'keyword',
    [snow.id]: 'semantic',
    [feast.id]: 'semantic',
    [camp.id]: 'semantic'
  });
  expect(both.hits.slice(0, 2).map(hitId).sort()).toEqual([documentId, order.id].sort());
  expect(both.hits.find(hit => hitId(hit) === general.id)).not.toHaveProperty('similarity');
  expect(both.hits.find(hit => hitId(hit) === documentId)).toMatchObject({
    passages: [{ startLine: 1, endLine: 3, text: '将军守城。\n城外下雪。\n斥候回营。' }]
  });

  const first = await search({ query: '将军', question, limit: 2 });
  expect(first.hasMore).toBe(true);
  const rest = await search({ query: '将军', question, offset: 2 });
  expect(rest.hasMore).toBe(false);
  expect([...first.hits, ...rest.hits].map(hitId)).toEqual(both.hits.map(hitId));
});

it('检索时只为没算过的文字补向量：本会话待接受的修改和新写的章节，算过的不再发送', async () => {
  await indexed();
  let seen = server.requests.length;
  const sent = () => {
    const inputs = server.requests.slice(seen).map(request => request.input);
    seen = server.requests.length;
    return inputs;
  };

  expect(
    (
      await call('work_write', {
        workId,
        entryId: documentId,
        expectedRevisionId: revisionId,
        content: '公主远行，渡口起雾。'
      })
    ).isError
  ).toBe(false);
  const question = '渡口的天气';
  const draft = await search({ question });
  expect(draft.hits).toMatchObject([
    {
      kind: 'entry',
      matchedBy: 'semantic',
      entry: { entryId: documentId },
      pending: true,
      passages: [{ startLine: 1, endLine: 1, text: '公主远行，渡口起雾。' }]
    }
  ]);
  expect(sent()).toEqual([['序章\n公主远行，渡口起雾。'], [question]]);
  await search({ question });
  expect(sent()).toEqual([[question]]);

  // 其他会话看到的仍是正式稿，它的向量在建立索引时已经算好。
  const other = (await host.execute({
    method: 'create',
    input: { model: { provider: 'offline-tools', id: 'offline' }, workId: null }
  })) as string;
  expect((await search({ question }, other)).hits).toMatchObject([
    { entry: { entryId: documentId }, pending: false, passages: [{ text: '将军守城。\n城外下雪。\n斥候回营。' }] }
  ]);
  expect(sent()).toEqual([[question]]);
  // 待接受修改的向量不计入索引进度。
  expect(await status()).toMatchObject({ total: 1, indexed: 1 });

  author('渡口', '艄公收了船。');
  expect(await status()).toMatchObject({ total: 2, indexed: 1 });
  expect((await search({ question }, other)).hits).toHaveLength(2);
  expect(sent()).toEqual([['渡口\n艄公收了船。'], [question]]);
  expect(await status()).toMatchObject({ total: 2, indexed: 2, pendingCharacters: 0 });
});

it('检索服务出错时不重试，只按关键词检索并说明原因；恢复后照常按意思检索', async () => {
  await indexed();
  const built = server.requests.length;
  const busy = { status: 503, body: { error: { message: 'overloaded.' } } };
  const notice = '没有做语义检索：检索服务返回 HTTP 503：overloaded。';
  const question = '谁在守城';

  server.replyWith(busy);
  const fallback = await search({ query: '守城', question });
  expect(fallback).toMatchObject({ hits: [{ matchedBy: 'keyword', entry: { entryId: documentId } }], notice });
  expect(server.requests).toHaveLength(built + 1);

  server.replyWith(busy);
  expect(await search({ question })).toEqual({ hits: [], hasMore: false, notice });

  const recovered = await search({ question });
  expect(recovered.notice).toBeUndefined();
  expect(recovered.hits).toMatchObject([{ matchedBy: 'semantic', entry: { entryId: documentId } }]);

  // 补算新段落时出错也一样：不重试，也不再为问题发请求。
  author('渡口', '艄公收了船。');
  const before = server.requests.length;
  server.replyWith(busy);
  expect(await search({ question })).toEqual({ hits: [], hasMore: false, notice });
  expect(server.requests.slice(before).map(request => request.input)).toEqual([['渡口\n艄公收了船。']]);
});

it('检索前补算全部没算的段落并报告段数，停止生成可以中断；语义命中只取最接近的二十段', async () => {
  await indexed();
  for (let index = 1; index <= 55; index++) author(`第${index}回`, `这是第${index}回的正文，写到第${index}天。`);
  const built = server.requests.length;
  const question = '第七天发生了什么';

  // 中断时已经算好的段落留在索引里。
  const stop = new AbortController();
  const release = server.hold(2);
  const stopped = call('work_search', { workId, question, offset: 0, limit: 10 }, randomUUID(), stop.signal);
  await vi.waitFor(() => expect(server.requests).toHaveLength(built + 3));
  stop.abort();
  release();
  expect((await stopped).isError).toBe(true);
  expect(await status()).toMatchObject({ total: 56, indexed: 21 });
  const interrupted = server.requests.length;

  const page = await search({ question, limit: 30 });
  expect(page.notice).toBeUndefined();
  expect(page).toMatchObject({ embedded: 35, hasMore: false });
  expect(server.requests.slice(interrupted).map(request => request.input.length)).toEqual([10, 10, 10, 5, 1]);
  expect(await status()).toMatchObject({ total: 56, indexed: 56 });
  expect(page.hits).toHaveLength(20);
  const similarities = page.hits.map(hit => hit.similarity!);
  expect(similarities).toEqual([...similarities].sort((a, b) => b - a));

  const first = await search({ question });
  expect(first).not.toHaveProperty('embedded');
  expect(first.hits).toHaveLength(10);
  expect(first.hasMore).toBe(true);
  const second = await search({ question, offset: 10 });
  expect(second.hits).toHaveLength(10);
  expect(second.hasMore).toBe(false);
  expect([...first.hits, ...second.hits].map(hitId)).toEqual(page.hits.map(hitId));
});
