/** 一次 embedding 调用用到的连接；dimensions 为 null 时不向服务指定维度。 */
export interface EmbeddingConnection {
  baseUrl: string;
  model: string;
  dimensions: number | null;
  apiKey?: string;
}

/** 检索服务没有完成请求。retryable 表示服务繁忙或暂时连不上，稍后再试可能成功。 */
export class EmbeddingRequestError extends Error {
  readonly retryable: boolean;
  /** 服务通过 Retry-After 要求的等待时间。 */
  readonly retryAfterMs: number | undefined;

  constructor(message: string, retryable: boolean, retryAfterMs?: number) {
    super(message);
    this.retryable = retryable;
    this.retryAfterMs = retryAfterMs;
  }
}

function failureMessage(text: string): string {
  try {
    const body = JSON.parse(text) as { error?: { message?: unknown } | string; message?: unknown };
    const message = typeof body.error === 'object' ? body.error?.message : (body.error ?? body.message);
    if (typeof message === 'string' && message) return message;
  } catch {
    // 不是 JSON 时直接展示服务返回的文字。
  }
  return text.trim().slice(0, 200);
}

/** 按 OpenAI 兼容的 /embeddings 接口为每段文字取一个向量，顺序与 input 一致。 */
export async function embed(
  { baseUrl, model, dimensions, apiKey }: EmbeddingConnection,
  input: readonly string[],
  signal?: AbortSignal
): Promise<Float32Array[]> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl.replace(/\/+$/, '')}/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(apiKey && { Authorization: `Bearer ${apiKey}` }) },
      body: JSON.stringify({ model, input, encoding_format: 'float', ...(dimensions !== null && { dimensions }) }),
      signal
    });
  } catch (error) {
    if (signal?.aborted) throw error;
    throw new EmbeddingRequestError('无法连接检索服务，请检查服务地址和网络', true);
  }
  const text = await response.text();
  if (!response.ok) {
    const detail = failureMessage(text);
    const wait = Number(response.headers.get('retry-after'));
    throw new EmbeddingRequestError(
      `检索服务返回 HTTP ${response.status}${detail ? `：${detail}` : ''}`,
      response.status === 429 || response.status >= 500,
      Number.isFinite(wait) && response.headers.has('retry-after') ? wait * 1000 : undefined
    );
  }

  let data: unknown;
  try {
    data = (JSON.parse(text) as { data?: unknown }).data;
  } catch {
    throw new EmbeddingRequestError('检索服务返回的不是 JSON，请确认服务地址指向 OpenAI 兼容接口', false);
  }
  const items = Array.isArray(data) ? (data as { index?: unknown; embedding?: unknown }[]) : [];
  const vectors = [...items]
    .sort((a, b) => Number(a.index) - Number(b.index))
    .map(item => (Array.isArray(item.embedding) ? Float32Array.from(item.embedding as number[]) : new Float32Array()));
  const width = vectors[0]?.length ?? 0;
  if (vectors.length !== input.length || width === 0 || vectors.some(vector => vector.length !== width))
    throw new EmbeddingRequestError('检索服务返回的向量与请求的文字对不上', false);
  if (vectors.some(vector => vector.some(Number.isNaN)))
    throw new EmbeddingRequestError('检索服务返回的向量里有不是数字的值', false);
  if (dimensions !== null && width !== dimensions)
    throw new EmbeddingRequestError(`检索服务返回 ${width} 维向量，与设置的 ${dimensions} 维不一致`, false);
  return vectors;
}
