import { describe, expect, it } from 'vitest';

import { IDLE_TIMEOUT, withIdleTimeout } from '../idle-timeout';

describe('流空闲超时', () => {
  it('透传正常值，包括空值，并关闭源迭代器', async () => {
    let closed = false;
    async function* source() {
      try {
        yield null;
        yield undefined;
        yield '正文';
      } finally {
        closed = true;
      }
    }
    const values = [];
    for await (const value of withIdleTimeout(source(), 1000)) values.push(value);
    expect(values).toEqual([null, undefined, '正文']);
    expect(closed).toBe(true);
  });

  it('消费方提前停止时释放源', async () => {
    let closed = false;
    async function* source() {
      try {
        yield '第一段';
        yield '第二段';
      } finally {
        closed = true;
      }
    }
    for await (const part of withIdleTimeout(source(), 1000)) {
      expect(part).toBe('第一段');
      break;
    }
    expect(closed).toBe(true);
  });

  it('源停止产出时返回独立哨兵，不等待挂起的收尾', async () => {
    const pending = Promise.withResolvers<void>();
    async function* source() {
      yield '已收到';
      await pending.promise;
    }
    try {
      const values = [];
      for await (const value of withIdleTimeout(source(), 10)) values.push(value);
      expect(values).toEqual(['已收到', IDLE_TIMEOUT]);
    } finally {
      pending.resolve();
    }
  });
});
