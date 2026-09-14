import { describe, expect, it } from 'vitest';

import type { FileIdentity } from '../../file-identity';
import { compareRestore } from '../restore-plan';

function side(relativePath: string, digest: string, bytes: number): FileIdentity {
  return { relativePath, bytes, digest };
}

describe('恢复比对', () => {
  it('四类动作各归各位：新增 / 一致 / 冲突，本地独有的只报个数', () => {
    const plan = compareRestore({
      archive: [side('正文.md', 'A', 100), side('草稿/01.md', 'B', 200), side('灵感/片段.md', 'C', 300)],
      local: [
        side('正文.md', 'A', 100),
        side('草稿/01.md', 'B2', 210),
        side('灵感/片段.md', 'C3', 330),
        side('番外.md', 'D', 40)
      ]
    });

    expect(plan.entries).toEqual([
      { relativePath: '正文.md', verdict: 'identical', archiveBytes: 100, localBytes: 100, system: false },
      { relativePath: '灵感/片段.md', verdict: 'conflict', archiveBytes: 300, localBytes: 330, system: false },
      { relativePath: '草稿/01.md', verdict: 'conflict', archiveBytes: 200, localBytes: 210, system: false }
    ]);
    // 番外.md 只在本地：三种模式都不动它。
    expect(plan.localOnly).toBe(1);
  });
  it('应用数据只标记分组，不改变比对结论', () => {
    const plan = compareRestore({
      archive: [side('.chaptale/memory/notes.md', 'A', 10), side('.chaptale/derived.md', 'B', 10)],
      local: [side('.chaptale/memory/notes.md', 'A2', 20)]
    });

    expect(plan.entries.map(entry => [entry.relativePath, entry.verdict, entry.system])).toEqual([
      ['.chaptale/derived.md', 'add', true],
      ['.chaptale/memory/notes.md', 'conflict', true]
    ]);
    // 名字里带 .chaptale 但不是那个目录的，不算应用数据。
    expect(compareRestore({ archive: [side('.chaptale-notes.md', 'C', 1)], local: [] }).entries[0]?.system).toBe(false);
  });
  it('判一致看内容不看大小，也不看修改时间', () => {
    const same = compareRestore({ archive: [side('正文.md', 'A', 10)], local: [side('正文.md', 'A', 999)] });

    expect(same.entries[0]?.verdict).toBe('identical');

    const different = compareRestore({ archive: [side('正文.md', 'A', 10)], local: [side('正文.md', 'B', 10)] });

    expect(different.entries[0]?.verdict).toBe('conflict');
  });
  it('归档里没有的文件按新增算，本地为空时全部新增', () => {
    const plan = compareRestore({ archive: [side('正文.md', 'A', 100), side('草稿/01.md', 'B', 200)], local: [] });

    expect(plan.entries.map(entry => entry.verdict)).toEqual(['add', 'add']);
    expect(plan.entries.every(entry => entry.localBytes === null)).toBe(true);
    expect(plan.localOnly).toBe(0);
  });
  it('空归档既不新增也不误报冲突，本地文件全部保留', () => {
    const plan = compareRestore({ archive: [], local: [side('正文.md', 'A', 100)] });

    expect(plan.entries).toEqual([]);
    expect(plan.localOnly).toBe(1);
  });
  it('顺序可预期：清单按路径排序，与两侧来源顺序无关', () => {
    const plan = compareRestore({
      archive: [side('二.md', 'B', 10), side('一.md', 'A', 10)],
      local: [side('一.md', 'A', 10), side('二.md', 'B', 10)]
    });

    expect(plan.entries.map(entry => entry.relativePath)).toEqual(['一.md', '二.md']);
  });
});
