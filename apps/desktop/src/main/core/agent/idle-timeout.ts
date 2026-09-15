export const IDLE_TIMEOUT = Symbol('idle-timeout');

/** 只计算相邻产出的间隔；收尾不等待可能已经挂起的源迭代器。 */
export async function* withIdleTimeout<T>(
  source: AsyncIterable<T>,
  timeoutMs: number
): AsyncGenerator<T | typeof IDLE_TIMEOUT> {
  const iterator = source[Symbol.asyncIterator]();

  try {
    let next = await raceIdleTimeout(iterator.next(), timeoutMs);
    while (next !== IDLE_TIMEOUT && !next.done) {
      yield next.value;
      next = await raceIdleTimeout(iterator.next(), timeoutMs);
    }
    if (next === IDLE_TIMEOUT) yield IDLE_TIMEOUT;
  } finally {
    void iterator.return?.().catch(() => undefined);
  }
}

function raceIdleTimeout<T>(next: Promise<T>, timeoutMs: number): Promise<T | typeof IDLE_TIMEOUT> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    next,
    new Promise<typeof IDLE_TIMEOUT>(resolve => {
      timer = setTimeout(() => resolve(IDLE_TIMEOUT), timeoutMs);
    })
  ]).finally(() => clearTimeout(timer));
}
