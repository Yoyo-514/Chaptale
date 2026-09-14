import { describe, expect, it } from 'vitest';

import { fetchPage } from '../fetch/fetch-page';

describe('页面抓取取消', () => {
  it('已取消的操作在 DNS 和网络请求之前返回原始取消原因', async () => {
    const reason = new Error('作者已停止本次抓取');

    await expect(
      fetchPage(
        'http://127.0.0.1/',
        {},
        { timeoutSeconds: 10, maxBytes: 1024, allowRanges: [], signal: AbortSignal.abort(reason) }
      )
    ).rejects.toBe(reason);
  });
});
