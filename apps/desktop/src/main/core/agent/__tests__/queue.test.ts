import { describe, expect, it } from 'vitest';

import { AsyncMessageQueue } from '../queue';

async function collect<T>(queue: AsyncMessageQueue<T>) {
  const items: T[] = [];

  for await (const item of queue.drain()) {
    items.push(item);
  }

  return items;
}

describe('AsyncMessageQueue', () => {
  it('drains pushed items in order until finish', async () => {
    const queue = new AsyncMessageQueue<number>();
    const drained = collect(queue);

    queue.push(1);
    queue.push(2);
    queue.finish();
    queue.push(3);

    await expect(drained).resolves.toEqual([1, 2, 3]);
  });

  it('wakes a waiting consumer when items arrive later', async () => {
    const queue = new AsyncMessageQueue<string>();
    const drained = collect(queue);

    await Promise.resolve();
    queue.push('a');
    queue.finish();

    await expect(drained).resolves.toEqual(['a']);
  });

  it('keeps the first failure and ignores later ones', () => {
    const queue = new AsyncMessageQueue<never>();
    const first = new Error('first');

    queue.finish(first);
    queue.finish(new Error('second'));

    expect(queue.failure).toBe(first);
  });
});
