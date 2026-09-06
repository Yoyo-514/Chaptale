import { createPinia, disposePinia, getActivePinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { useWorkspaceStore } from '@/features/workspace';

import { useEditorStore } from '../store';
import type { EditorTab } from '../types';

beforeEach(() => {
  setActivePinia(createPinia());
  useWorkspaceStore().rootPath = 'E:/novel';
});

afterEach(() => {
  disposePinia(getActivePinia()!);
});

function tab(id: string, path = `${id}.md`): EditorTab {
  return {
    id,
    path,
    title: path.split('/').at(-1)!,
    readonly: true,
    dirty: false,
    status: 'ready',
    allowLarge: false,
    error: null,
    document: {
      rootPath: 'E:/novel',
      relativePath: path,
      content: '',
      head: { status: 'none', body: '' },
      contentHash: 'empty',
      sizeBytes: 0,
      mtimeMs: 1
    }
  };
}

describe('只读标签生命周期', () => {
  it('未打开工作区时不创建标签', async () => {
    useWorkspaceStore().rootPath = null;
    const editor = useEditorStore();
    await editor.openDocument('chapter.md');
    expect(editor.tabs).toEqual([]);
    expect(editor.activeId).toBe('');
  });

  it('重复打开只聚焦已有标签，不重新读取或清空快照', async () => {
    const editor = useEditorStore();
    editor.tabs = [tab('a', '正文/一.md'), tab('b')];
    editor.activeId = 'b';
    const snapshot = editor.tabs[0]!.document;

    await editor.openDocument('正文/一.md');

    expect(editor.tabs).toHaveLength(2);
    expect(editor.activeTab?.id).toBe('a');
    expect(editor.activeTab?.document).toBe(snapshot);
    expect(editor.activeTab?.status).toBe('ready');
  });

  it('关闭后台标签不改变当前文件，关闭当前标签优先选择右邻', () => {
    const editor = useEditorStore();
    editor.tabs = [tab('a'), tab('b'), tab('c'), tab('d')];
    editor.activeId = 'b';
    editor.closeTab('a');
    expect(editor.activeId).toBe('b');
    editor.closeTab('b');
    expect(editor.activeId).toBe('c');
    editor.closeTab('d');
    expect(editor.activeId).toBe('c');
    editor.closeTab('c');
    expect(editor.activeTab).toBeNull();
    expect(editor.tabs).toEqual([]);
  });

  it('工作区路径或代次变化立即清空全部标签', () => {
    const workspace = useWorkspaceStore();
    const editor = useEditorStore();
    editor.tabs = [tab('a')];
    editor.activeId = 'a';
    workspace.rootPath = 'E:/another';
    expect(editor.tabs).toEqual([]);
    expect(editor.activeId).toBe('');
    editor.tabs = [tab('b')];
    editor.activeId = 'b';
    workspace.revision += 1;
    expect(editor.tabs).toEqual([]);
    expect(editor.activeId).toBe('');
  });

  it('选区和滚动位置属于各标签，关闭后迟到的视图状态不能复活标签', () => {
    const editor = useEditorStore();
    editor.tabs = [tab('a'), tab('b')];
    editor.activeId = 'a';
    const state = { anchor: 4, head: 8, scrollTop: 240, scrollLeft: 0 };
    editor.rememberView('a', state);
    expect(editor.tabs[0]!.viewState).toEqual(state);
    expect(editor.tabs[1]!.viewState).toBeUndefined();
    editor.closeTab('a');
    editor.rememberView('a', state);
    expect(editor.tabs.map(item => item.id)).toEqual(['b']);
  });

  it('未知标签不改变焦点，仅已就绪的文档接受查找命令', () => {
    const editor = useEditorStore();
    editor.requestSearch();
    expect(editor.searchRequest).toBe(0);
    editor.tabs = [tab('a')];
    editor.activeId = 'a';
    editor.selectTab('missing');
    expect(editor.activeId).toBe('a');
    editor.requestSearch();
    expect(editor.searchRequest).toBe(1);
  });
});
