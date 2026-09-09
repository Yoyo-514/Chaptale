import { describe, expect, it } from 'vitest';

import type { EditorTab } from '@/features/editor';

import { describeSyncFile, localSyncSummary } from '../sync-status';

function tab(values: Partial<EditorTab> = {}): EditorTab {
  return {
    id: 'chapter',
    path: '正文/第一章.md',
    title: '第一章',
    readonly: false,
    dirty: false,
    status: 'ready',
    document: null,
    error: null,
    allowLarge: false,
    ...values
  };
}
describe('本地文件状态', () => {
  it('未打开作品、未保存、正在保存与完成有不同状态', () => {
    expect(localSyncSummary(null, [])).toEqual({ label: '未打开作品', error: false });
    expect(localSyncSummary('/work', [tab()])).toEqual({ label: '本地已保存', error: false });
    expect(localSyncSummary('/work', [tab({ dirty: true })]).label).toBe('等待本地保存');
    expect(localSyncSummary('/work', [tab({ dirty: true, saving: true })]).label).toBe('正在保存到本地');
    expect(describeSyncFile(tab({ notice: '已载入磁盘更新' })).label).toBe('已载入外部更新');
  });
  it('冲突和读写错误优先显示，保留实际诊断', () => {
    const missing = tab({ external: { ok: false, code: 'not-found', message: '文件已删除' }, dirty: true });
    expect(describeSyncFile(missing)).toEqual({ label: '磁盘文件已删除', detail: '文件已删除', issue: true });
    expect(describeSyncFile(tab({ saveError: '权限不足' }))).toEqual({
      label: '保存失败',
      detail: '权限不足',
      issue: true
    });
    expect(describeSyncFile(tab({ recoveryError: '恢复目录不可写' })).issue).toBe(true);
    expect(localSyncSummary('/work', [missing, tab({ saveError: '只读' }), tab({ saving: true })])).toEqual({
      label: '2 个文件待处理',
      error: true
    });
  });
});
