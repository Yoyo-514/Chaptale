import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useSettingsStore } from '@/features/settings';

import { useFileTreeStore } from '../file-tree/store';

type Entry = { name: string; kind: 'file' | 'directory'; relativePath: string };

function dir(name: string, parent = ''): Entry {
  return { name, kind: 'directory', relativePath: parent ? `${parent}/${name}` : name };
}

function file(name: string, parent = ''): Entry {
  return { name, kind: 'file', relativePath: parent ? `${parent}/${name}` : name };
}

/** listDirectory / createEntry 的替身：按 (relativePath, includeInternal) 返回预置目录内容。 */
function installDesktopApi(layout: Record<string, Entry[]>, internalLayout: Record<string, Entry[]> = {}) {
  const listDirectory = vi.fn(async ({ relativePath = '', includeInternal = false }) => {
    const source = includeInternal ? { ...layout, ...internalLayout } : layout;
    const entries = source[relativePath];

    if (!entries) return { ok: false as const, code: 'not-found' as const, message: `缺少目录 ${relativePath}` };
    return { ok: true as const, entries };
  });

  // 真实写入 layout，让建完刷新父目录能看到新条目。
  const createEntry = vi.fn(async ({ relativePath, kind }: { relativePath: string; kind: 'file' | 'directory' }) => {
    const name = relativePath.split('/').at(-1) as string;
    const parent = relativePath.split('/').slice(0, -1).join('/');

    if ((layout[parent] ?? []).some(entry => entry.name === name)) {
      return { ok: false as const, code: 'already-exists' as const, message: `${name} 已存在` };
    }

    const entry = kind === 'directory' ? dir(name, parent) : file(name, parent);
    layout[parent] = [...(layout[parent] ?? []), entry];
    if (kind === 'directory') layout[relativePath] = [];

    return { ok: true as const, entry };
  });

  window.chaptaleDesktop = { workspace: { listDirectory, createEntry } } as never;
  return { listDirectory, createEntry };
}

/** 让 settings store 持有一份可读的快照，file-tree store 的 watch 才有东西可跟随。 */
function installSettings(showInternalFiles: boolean) {
  const store = useSettingsStore();
  store.state = {
    settings: { version: 1, storage: { mode: 'global' }, explorer: { showInternalFiles }, theme: 'dark' },
    paths: { currentCwd: '/w', effectiveSessionDir: '/w/.chaptale' }
  } as never;
  return store;
}

beforeEach(() => {
  setActivePinia(createPinia());
  vi.restoreAllMocks();
  delete (window as { chaptaleDesktop?: unknown }).chaptaleDesktop;
});

describe('file tree store', () => {
  it('展开目录后按层级铺平可见行', async () => {
    installDesktopApi({
      '': [dir('chapters'), file('README.md')],
      chapters: [file('01.md', 'chapters')]
    });
    const tree = useFileTreeStore();

    await tree.load();
    expect(tree.visibleRows.map(row => [row.name, row.depth])).toStrictEqual([
      ['chapters', 0],
      ['README.md', 0]
    ]);

    await tree.toggle('chapters');
    expect(tree.visibleRows.map(row => [row.name, row.depth, row.expanded])).toStrictEqual([
      ['chapters', 0, true],
      ['01.md', 1, false],
      ['README.md', 0, false]
    ]);
  });

  it('已缓存目录不重复请求，折叠不会丢掉缓存', async () => {
    const { listDirectory } = installDesktopApi({ '': [dir('chapters')], chapters: [] });
    const tree = useFileTreeStore();

    await tree.load();
    await tree.toggle('chapters');
    await tree.toggle('chapters');
    await tree.toggle('chapters');

    expect(listDirectory).toHaveBeenCalledTimes(2);
  });

  it('切换内部文件显隐会重新拉取根目录与所有已展开目录', async () => {
    const { listDirectory } = installDesktopApi(
      { '': [dir('chapters')], chapters: [file('01.md', 'chapters')] },
      {
        '': [dir('.chaptale'), dir('chapters')],
        chapters: [dir('.cache', 'chapters'), file('01.md', 'chapters')]
      }
    );
    const tree = useFileTreeStore();

    await tree.load();
    await tree.toggle('chapters');
    listDirectory.mockClear();

    await tree.applyShowInternalFiles(true);

    expect(listDirectory.mock.calls.map(([args]) => args)).toStrictEqual(
      expect.arrayContaining([
        { relativePath: '', includeInternal: true },
        { relativePath: 'chapters', includeInternal: true }
      ])
    );
    expect(tree.visibleRows.map(row => row.name)).toStrictEqual(['.chaptale', 'chapters', '.cache', '01.md']);
  });

  it('重复设置同一个显隐值不会触发请求', async () => {
    const { listDirectory } = installDesktopApi({ '': [] });
    const tree = useFileTreeStore();

    await tree.load();
    listDirectory.mockClear();

    await tree.applyShowInternalFiles(false);

    expect(listDirectory).not.toHaveBeenCalled();
  });

  it('显隐开关落盘到设置，界面跟着新快照走', async () => {
    installDesktopApi({ '': [] }, { '': [dir('.chaptale')] });
    const settings = installSettings(false);
    const update = vi.fn(async (payload: { explorer?: { showInternalFiles?: boolean } }) => {
      // 真实 settings store 会整体替换快照；这里照做，让 watch 拿到新值。
      settings.state = {
        ...settings.state,
        settings: { ...settings.state!.settings, explorer: { showInternalFiles: payload.explorer!.showInternalFiles! } }
      } as never;
      return settings.state;
    });
    settings.update = update as never;

    const tree = useFileTreeStore();
    await tree.load();
    await tree.setShowInternalFiles(true);

    expect(update).toHaveBeenCalledWith({ explorer: { showInternalFiles: true } });
    expect(tree.showInternalFiles).toBe(true);
    expect(tree.visibleRows.map(row => row.name)).toStrictEqual(['.chaptale']);
  });

  it('落盘失败时不改界面，免得下次启动又变回去', async () => {
    installDesktopApi({ '': [] }, { '': [dir('.chaptale')] });
    const settings = installSettings(false);
    // 真实 store 的 update 捕获异常后快照保持原值，返回 undefined。
    settings.update = vi.fn(async () => undefined) as never;

    const tree = useFileTreeStore();
    await tree.load();
    await tree.setShowInternalFiles(true);

    expect(tree.showInternalFiles).toBe(false);
    expect(tree.visibleRows).toStrictEqual([]);
  });

  it('首次取数前先读设置偏好，不会先按默认值拉一遍', async () => {
    const { listDirectory } = installDesktopApi({ '': [] }, { '': [dir('.chaptale')] });
    const settings = installSettings(true);
    settings.load = vi.fn() as never;

    const tree = useFileTreeStore();
    await tree.loadPreferences();
    await tree.load();

    expect(listDirectory).toHaveBeenCalledTimes(1);
    expect(listDirectory).toHaveBeenCalledWith({ relativePath: '', includeInternal: true });
  });

  it('新建落在选中目录内，成功后选中新条目', async () => {
    const { createEntry } = installDesktopApi({ '': [dir('chapters')], chapters: [] });
    const tree = useFileTreeStore();

    await tree.load();
    tree.selectedPath = 'chapters';
    await tree.startCreation('file');

    expect(tree.pendingCreation).toStrictEqual({ parent: 'chapters', kind: 'file' });
    // 目标目录折叠时输入行看不见，开始新建应顺带展开。
    expect(tree.expanded.has('chapters')).toBe(true);

    const created = await tree.submitCreation('  01.md  ');

    expect(createEntry).toHaveBeenCalledWith({ relativePath: 'chapters/01.md', kind: 'file' });
    expect(created).toBe('chapters/01.md');
    expect(tree.selectedPath).toBe('chapters/01.md');
    expect(tree.pendingCreation).toBeNull();
    expect(tree.visibleRows.map(row => row.relativePath)).toStrictEqual(['chapters', 'chapters/01.md']);
  });

  it('选中文件时新建落在它的同级，无选中时落在根', async () => {
    installDesktopApi({ '': [dir('chapters')], chapters: [file('01.md', 'chapters')] });
    const tree = useFileTreeStore();

    await tree.load();
    await tree.toggle('chapters');
    tree.selectedPath = 'chapters/01.md';
    await tree.startCreation('file');
    expect(tree.pendingCreation).toStrictEqual({ parent: 'chapters', kind: 'file' });

    tree.selectedPath = '';
    await tree.startCreation('directory');
    expect(tree.pendingCreation).toStrictEqual({ parent: '', kind: 'directory' });
  });

  it('新建失败保留输入状态，不吞掉用户已输入的名字', async () => {
    installDesktopApi({ '': [file('README.md')] });
    const tree = useFileTreeStore();

    await tree.load();
    await tree.startCreation('file');
    const created = await tree.submitCreation('README.md');

    expect(created).toBeNull();
    expect(tree.pendingCreation).toStrictEqual({ parent: '', kind: 'file' });
  });

  it('折叠全部清空展开态但保留缓存', async () => {
    const { listDirectory } = installDesktopApi({ '': [dir('chapters')], chapters: [file('01.md', 'chapters')] });
    const tree = useFileTreeStore();

    await tree.load();
    await tree.toggle('chapters');
    listDirectory.mockClear();

    tree.collapseAll();
    expect(tree.expanded.size).toBe(0);
    expect(tree.visibleRows.map(row => row.name)).toStrictEqual(['chapters']);

    await tree.toggle('chapters');
    expect(listDirectory).not.toHaveBeenCalled();
  });

  it('重载时目录已消失则收回展开态', async () => {
    const layout: Record<string, Entry[]> = {
      '': [dir('chapters')],
      chapters: [file('01.md', 'chapters')]
    };
    installDesktopApi(layout);
    const tree = useFileTreeStore();

    await tree.load();
    await tree.toggle('chapters');
    expect(tree.expanded.has('chapters')).toBe(true);

    layout[''] = [];
    delete layout.chapters;
    await tree.reload();

    expect(tree.expanded.has('chapters')).toBe(false);
    expect(tree.visibleRows).toStrictEqual([]);
    expect(tree.errors.chapters).toBe('缺少目录 chapters');
  });

  it('读取失败时清掉旧结果并记录错误', async () => {
    const layout: Record<string, Entry[]> = { '': [file('README.md')] };
    installDesktopApi(layout);
    const tree = useFileTreeStore();

    await tree.load();
    expect(tree.visibleRows).toHaveLength(1);

    delete layout[''];
    await tree.reload();

    expect(tree.visibleRows).toStrictEqual([]);
    expect(tree.errors['']).toBe('缺少目录 ');
  });

  it('reset 清空缓存、展开态、错误与选中项', async () => {
    installDesktopApi({ '': [dir('chapters')], chapters: [] });
    const tree = useFileTreeStore();

    await tree.load();
    await tree.toggle('chapters');
    tree.selectedPath = 'chapters';
    await tree.startCreation('file');

    tree.reset();

    expect(tree.visibleRows).toStrictEqual([]);
    expect(tree.expanded.size).toBe(0);
    expect(tree.selectedPath).toBe('');
    expect(tree.pendingCreation).toBeNull();
    expect(Object.keys(tree.errors)).toStrictEqual([]);
  });
});
