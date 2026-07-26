import { describe, expect, it, vi } from 'vitest';

import { MemoryInjector } from '../injector';
import type { MemoryService } from '../service';

function createInjector(sections: Record<string, string>) {
  const memoryService = { readSections: vi.fn(async () => sections) } as unknown as MemoryService;
  return { injector: new MemoryInjector(memoryService), memoryService };
}

describe('MemoryInjector', () => {
  it('injects the block on the first turn and suppresses identical repeats', async () => {
    const { injector } = createInjector({ preferences: '- 喜欢短句' });

    const first = await injector.resolvePrefix('session-1', '/cwd');
    const second = await injector.resolvePrefix('session-1', '/cwd');

    expect(first).toContain('喜欢短句');
    expect(first.endsWith('\n\n')).toBe(true);
    expect(second).toBe('');
  });

  it('tracks sessions independently', async () => {
    const { injector } = createInjector({ preferences: '- 喜欢短句' });

    await injector.resolvePrefix('session-1', '/cwd');
    const other = await injector.resolvePrefix('session-2', '/cwd');

    expect(other).toContain('喜欢短句');
  });

  it('re-injects after reset', async () => {
    const { injector } = createInjector({ preferences: '- 喜欢短句' });

    await injector.resolvePrefix('session-1', '/cwd');
    injector.reset();

    await expect(injector.resolvePrefix('session-1', '/cwd')).resolves.toContain('喜欢短句');
  });

  it('returns empty for empty memory and never throws on read failure', async () => {
    const failing = {
      readSections: vi.fn(async () => {
        throw new Error('disk error');
      })
    } as unknown as MemoryService;

    await expect(new MemoryInjector(failing).resolvePrefix('s', '/cwd')).resolves.toBe('');

    const { injector } = createInjector({});
    await expect(injector.resolvePrefix('s', '/cwd')).resolves.toBe('');
  });
});
