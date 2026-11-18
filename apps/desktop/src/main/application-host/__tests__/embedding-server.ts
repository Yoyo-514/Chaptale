import { createServer, type IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';

export interface EmbeddingRequest {
  authorization: string | undefined;
  model: string;
  input: string[];
  dimensions: number | undefined;
}

type Reply = { status: number; body: unknown; headers?: Record<string, string> };

/** 没有指定 dimensions 时返回的向量长度。 */
export const defaultWidth = 8;

/** 由文字算出的固定向量：按字符落到各维上计数后归一，共用的字越多方向越接近。只用来验证协议与流程，不代表语义。 */
export function vectorOf(text: string, width = defaultWidth): number[] {
  const counts = Array.from({ length: width }, () => 0);
  for (const character of text) counts[character.codePointAt(0)! % width]! += 1;
  const norm = Math.hypot(...counts) || 1;
  return counts.map(count => count / norm);
}

async function json(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

/** 本机的 OpenAI 兼容 /embeddings 服务，记录收到的请求。 */
export async function startEmbeddingServer() {
  const requests: EmbeddingRequest[] = [];
  const replies: (Reply | 'ok')[] = [];
  let gate: Promise<void> | undefined;
  let passing = 0;
  const server = createServer(async (request, response) => {
    if (request.method !== 'POST' || request.url !== '/v1/embeddings') {
      response.writeHead(404).end('not found');
      return;
    }
    const body = await json(request);
    const received: EmbeddingRequest = {
      authorization: request.headers.authorization,
      model: body.model as string,
      input: body.input as string[],
      dimensions: body.dimensions as number | undefined
    };
    requests.push(received);
    if (passing > 0) passing -= 1;
    else await gate;
    const next = replies.shift();
    const reply =
      next !== undefined && next !== 'ok'
        ? next
        : {
            status: 200,
            body: {
              // 倒序返回，调用方须按 index 还原顺序。
              data: received.input
                .map((text, index) => ({ index, embedding: vectorOf(text, received.dimensions) }))
                .reverse()
            }
          };
    response.writeHead(reply.status, { 'Content-Type': 'application/json', ...reply.headers });
    response.end(typeof reply.body === 'string' ? reply.body : JSON.stringify(reply.body));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
    requests,
    /** 接下来的请求依次用这些回复，'ok' 表示正常返回向量；用完后恢复正常。 */
    replyWith(...next: (Reply | 'ok')[]) {
      replies.push(...next);
    },
    /** 先照常回复 pass 个请求，此后收到的请求在 release 之前不回复。 */
    hold(pass = 0) {
      passing = pass;
      let release!: () => void;
      gate = new Promise<void>(resolve => (release = resolve));
      return () => {
        gate = undefined;
        release();
      };
    },
    async close() {
      server.closeAllConnections();
      await new Promise(resolve => server.close(resolve));
    }
  };
}
