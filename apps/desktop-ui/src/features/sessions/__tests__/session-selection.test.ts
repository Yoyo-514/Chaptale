import { describe, expect, it } from 'vitest';

import type { ChaptaleSessionListItem } from '@chaptale/ipc-contract';

import { resolveSessionSelection } from '../session-selection';

function session(id: string): ChaptaleSessionListItem {
  return { id } as ChaptaleSessionListItem;
}

describe('resolveSessionSelection', () => {
  it('首次恢复：持久化选择在候选中则选中且无需再持久化', () => {
    const result = resolveSessionSelection({
      candidates: [session('a'), session('b')],
      allSessions: [session('a'), session('b')],
      currentSessionId: '',
      selectionRestored: false,
      persistedSessionId: 'b'
    });
    expect(result).toEqual({ nextSessionId: 'b', shouldPersist: false });
  });

  it('首次恢复：运行期已有选择优先于持久化选择', () => {
    const result = resolveSessionSelection({
      candidates: [session('a'), session('b')],
      allSessions: [session('a'), session('b')],
      currentSessionId: 'a',
      selectionRestored: false,
      persistedSessionId: 'b'
    });
    expect(result).toEqual({ nextSessionId: 'a', shouldPersist: true });
  });

  it('首次恢复：候选中不存在则回退第一个并持久化', () => {
    const result = resolveSessionSelection({
      candidates: [session('a')],
      allSessions: [session('a')],
      currentSessionId: '',
      selectionRestored: false,
      persistedSessionId: 'gone'
    });
    expect(result).toEqual({ nextSessionId: 'a', shouldPersist: true });
  });

  it('首次恢复：跨域槽位在全量列表存活则保留（不被 cwd 候选过滤误伤）', () => {
    const result = resolveSessionSelection({
      candidates: [session('a')],
      allSessions: [session('a'), session('other-ws')],
      currentSessionId: '',
      selectionRestored: false,
      persistedSessionId: 'other-ws'
    });
    expect(result).toEqual({ nextSessionId: 'other-ws', shouldPersist: false });
  });

  it('已恢复：当前选择仍存在于全量列表则保留（不依赖槽位同步）', () => {
    const result = resolveSessionSelection({
      candidates: [session('a')],
      allSessions: [session('a'), session('other-ws')],
      currentSessionId: 'other-ws',
      selectionRestored: true,
      persistedSessionId: ''
    });
    expect(result).toEqual({ nextSessionId: 'other-ws', shouldPersist: false });
  });

  it('已恢复：切域清空选择后不沿用槽位兑底（跨域槽位不回跳）', () => {
    const result = resolveSessionSelection({
      candidates: [session('a')],
      allSessions: [session('a'), session('other-ws')],
      currentSessionId: '',
      selectionRestored: true,
      persistedSessionId: 'other-ws'
    });
    expect(result).toEqual({ nextSessionId: 'a', shouldPersist: true });
  });

  it('已恢复：当前选择与槽位一致时无需再持久化', () => {
    const result = resolveSessionSelection({
      candidates: [session('a')],
      allSessions: [session('a'), session('other-ws')],
      currentSessionId: 'other-ws',
      selectionRestored: true,
      persistedSessionId: 'other-ws'
    });
    expect(result).toEqual({ nextSessionId: 'other-ws', shouldPersist: false });
  });

  it('已恢复：当前选择已不存在则回退候选第一个并持久化', () => {
    const result = resolveSessionSelection({
      candidates: [session('a')],
      allSessions: [session('a')],
      currentSessionId: 'deleted',
      selectionRestored: true,
      persistedSessionId: ''
    });
    expect(result).toEqual({ nextSessionId: 'a', shouldPersist: true });
  });

  it('运行期选择与槽位都失效时回退候选第一个', () => {
    const result = resolveSessionSelection({
      candidates: [session('a')],
      allSessions: [session('a')],
      currentSessionId: 'deleted',
      selectionRestored: true,
      persistedSessionId: 'gone'
    });
    expect(result).toEqual({ nextSessionId: 'a', shouldPersist: true });
  });

  it('空候选回退为空选择', () => {
    const result = resolveSessionSelection({
      candidates: [],
      allSessions: [],
      currentSessionId: '',
      selectionRestored: false,
      persistedSessionId: ''
    });
    expect(result).toEqual({ nextSessionId: '', shouldPersist: false });
  });
});
