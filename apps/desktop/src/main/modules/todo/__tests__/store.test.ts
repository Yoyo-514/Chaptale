import { mkdtempSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { promises as fs } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

import type { TodoItem } from '@chaptale/shared';

import { TodoStore } from '../store';

function createStore() {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'chaptale-todos-'));
  return { store: new TodoStore(dir), dir };
}

const items: TodoItem[] = [
  { id: '1', content: '写大纲', status: 'completed' },
  { id: '2', content: '写第一章', status: 'in_progress' }
];

describe('TodoStore', () => {
  it('returns an empty list when no file exists', async () => {
    const { store } = createStore();

    await expect(store.read('s1')).resolves.toEqual([]);
  });

  it('replaces and reads back the whole list', async () => {
    const { store } = createStore();

    await store.replace('s1', items);

    await expect(store.read('s1')).resolves.toEqual(items);
  });

  it('notifies listeners on replace and stops after unsubscribe', async () => {
    const { store } = createStore();
    const listener = vi.fn();
    const unsubscribe = store.onChange(listener);

    await store.replace('s1', items);
    expect(listener).toHaveBeenCalledWith('s1', items);

    unsubscribe();
    await store.replace('s1', []);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('tolerates corrupted files by returning an empty list', async () => {
    const { store, dir } = createStore();
    await fs.writeFile(path.join(dir, 's1.json'), '{broken', 'utf8');

    await expect(store.read('s1')).resolves.toEqual([]);
  });

  it('removes the session file and keeps other sessions intact', async () => {
    const { store } = createStore();
    await store.replace('s1', items);
    await store.replace('s2', items);

    await store.remove('s1');

    await expect(store.read('s1')).resolves.toEqual([]);
    await expect(store.read('s2')).resolves.toEqual(items);
  });

  it('sanitizes session ids so they cannot escape the todos directory', async () => {
    const { store, dir } = createStore();

    await store.replace('../escape', items);

    const files = await fs.readdir(dir);
    expect(files).toEqual(['___escape.json']);
  });
});
