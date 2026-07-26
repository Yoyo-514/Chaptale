import { describe, expect, it, vi } from 'vitest';

import { SessionPool, type DisposableSession } from '../session-pool';

describe('SessionPool', () => {
  it('deduplicates concurrent creation by key', async () => {
    let release!: (value: DisposableSession) => void;
    const created = new Promise<DisposableSession>(resolve => (release = resolve));
    const create = vi.fn(() => created);
    const pool = new SessionPool<DisposableSession>(create);

    const first = pool.get('s1');
    const second = pool.get('s1');
    release({ dispose: vi.fn() });

    await expect(Promise.all([first, second])).resolves.toHaveLength(2);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('evicts failed creation so later get retries', async () => {
    const create = vi
      .fn<() => Promise<DisposableSession>>()
      .mockRejectedValueOnce(new Error('open failed'))
      .mockResolvedValueOnce({ dispose: vi.fn() });
    const pool = new SessionPool<DisposableSession>(create);

    await expect(pool.get('s1')).rejects.toThrow('open failed');
    await expect(pool.get('s1')).resolves.toBeTruthy();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('disposes resolved sessions on invalidate', async () => {
    const dispose = vi.fn();
    const pool = new SessionPool(async (key: string) => ({ key, dispose }));

    await pool.get('s1');
    await pool.get('s2');
    pool.invalidate();
    await Promise.resolve();

    expect(dispose).toHaveBeenCalledTimes(2);
  });

  it('disposes only the targeted key when invalidating one session', async () => {
    const disposals: string[] = [];
    const pool = new SessionPool(async (key: string) => ({
      dispose: () => {
        disposals.push(key);
      }
    }));

    await pool.get('s1');
    await pool.get('s2');
    pool.invalidate('s1');
    await Promise.resolve();

    expect(disposals).toEqual(['s1']);
    expect(await pool.get('s2')).toBeTruthy();
  });

  it('does not let a stale rejected creation delete a newer entry', async () => {
    let rejectOld!: (error: Error) => void;
    let resolveNew!: (session: DisposableSession) => void;
    const oldCreated = new Promise<DisposableSession>((_resolve, reject) => (rejectOld = reject));
    const newCreated = new Promise<DisposableSession>(resolve => (resolveNew = resolve));
    const create = vi
      .fn<() => Promise<DisposableSession>>()
      .mockReturnValueOnce(oldCreated)
      .mockReturnValueOnce(newCreated);
    const pool = new SessionPool<DisposableSession>(create);

    const old = pool.get('s1');
    pool.invalidate('s1');
    const next = pool.get('s1');

    rejectOld(new Error('old failed'));
    await expect(old).rejects.toThrow('old failed');
    resolveNew({ dispose: vi.fn() });

    await expect(next).resolves.toBeTruthy();
    await expect(pool.get('s1')).resolves.toBeTruthy();
    expect(create).toHaveBeenCalledTimes(2);
  });

  it('ignores dispose failures during invalidate', async () => {
    const pool = new SessionPool(async () => ({
      dispose: () => {
        throw new Error('dispose failed');
      }
    }));

    await pool.get('s1');

    expect(() => pool.invalidate()).not.toThrow();
    await expect(Promise.resolve()).resolves.toBeUndefined();
  });
});
