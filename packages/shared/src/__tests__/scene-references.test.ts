import { describe, expect, it } from 'vitest';

import type { AssetRecord, ReferenceSelection } from '../library';
import { selectSceneReferences } from '../scene-references';

const asset = (sourcePath: string, kind: string, frontmatter: Record<string, unknown> = {}): AssetRecord => ({
  sourcePath,
  kind,
  title: sourcePath.split('/').at(-1)!.replace('.md', ''),
  role: 'outline',
  contentHash: 'a'.repeat(64),
  updatedAt: '2026-09-08',
  sizeBytes: 1,
  chars: 1,
  excerpt: '',
  aliases: [],
  links: [],
  backlinks: [],
  frontmatter,
  ...(typeof frontmatter.status === 'string' ? { status: frontmatter.status } : {})
});
const scene = asset('大纲/场景.md', 'scene-card', {
  chapter: '[[正文/二.md]]',
  cast: ['[[角色/甲.md]]'],
  location: '[[设定/桥.md]]',
  threads: ['[[伏笔/手选.md]]'],
  goal: '桥下见面'
});
const assets = [
  scene,
  asset('正文/一.md', 'chapter', { order: 1 }),
  asset('正文/二.md', 'chapter', { order: 2 }),
  asset('正文/三.md', 'chapter', { order: 3 }),
  asset('角色/甲.md', 'character', { relations: [{ to: '[[角色/乙.md]]', type: '同伴' }] }),
  asset('角色/乙.md', 'character'),
  asset('设定/桥.md', 'world'),
  asset('伏笔/手选.md', 'plot-thread'),
  asset('伏笔/已埋.md', 'plot-thread', { status: 'advanced', plantedAt: '[[正文/一.md]]' }),
  asset('伏笔/未来.md', 'plot-thread', { status: 'planted', plantedAt: '[[正文/三.md]]' }),
  asset('伏笔/不明.md', 'plot-thread', { status: 'planted' }),
  asset('.chaptale/memory/summaries/recent.md', 'summary'),
  asset('设定/守则.md', 'style'),
  asset('手选.md', 'note')
];
describe('场景参考的确定性选择', () => {
  it('按情节顺序选择，不递归展开人物关系，不采用未来伏笔', () => {
    const pin: ReferenceSelection = { sourcePath: '手选.md', pinned: true, mode: 'full', reason: '作者选择' };
    const result = selectSceneReferences(scene, assets, [pin]);
    expect(result.selections.map(value => value.sourcePath)).toEqual([
      scene.sourcePath,
      '角色/甲.md',
      '伏笔/手选.md',
      '伏笔/已埋.md',
      '设定/桥.md',
      '.chaptale/memory/summaries/recent.md',
      '设定/守则.md',
      '手选.md'
    ]);
    expect(result.goal).toBe('桥下见面');
    expect(result.chapterPath).toBe('正文/二.md');
    expect(result.diagnostics).toContain('不明：章序不明，未自动采用');
    expect(result.selections[1]!.mode).toBe('summary');
  });
  it('重组保留固定来源、自动项模式与临时排除', () => {
    const previous: ReferenceSelection[] = [
      { sourcePath: '角色/甲.md', pinned: false, mode: 'full' },
      { sourcePath: '设定/桥.md', pinned: true, mode: 'summary' },
      { sourcePath: '已经移动.md', pinned: true, mode: 'full' }
    ];
    const result = selectSceneReferences(scene, assets, previous, ['伏笔/已埋.md', '设定/桥.md']);
    expect(result.selections.find(value => value.sourcePath === '角色/甲.md')?.mode).toBe('full');
    expect(result.selections.some(value => value.sourcePath === '伏笔/已埋.md')).toBe(false);
    expect(result.selections.slice(-2)).toEqual(previous.slice(-2));
    expect(result.diagnostics.some(value => value.includes('固定来源不可用'))).toBe(true);
  });
  it('重名不猜测，损坏和已归档场景卡不可组装', () => {
    const ambiguous = { ...scene, frontmatter: { ...scene.frontmatter, cast: ['[[甲]]'] } };
    const result = selectSceneReferences(ambiguous, [...assets, asset('另一目录/甲.md', 'character')]);
    expect(result.diagnostics).toContain('[[甲]]：存在多个同名来源');
    expect(result.selections.some(value => value.sourcePath === '角色/甲.md')).toBe(false);
    expect(() => selectSceneReferences({ ...scene, status: 'archived' }, assets)).toThrow('有效场景卡');
  });
  it('兼容未声明 kind 的旧正文章节，但不把其他资产作为章节', () => {
    const legacy = structuredClone(assets);
    const chapter = legacy.find(value => value.sourcePath === '正文/二.md')!;
    chapter.kind = undefined;
    chapter.role = 'manuscript';
    expect(selectSceneReferences(scene, legacy).chapterPath).toBe('正文/二.md');
    chapter.kind = 'world';
    expect(selectSceneReferences(scene, legacy).chapterPath).toBeUndefined();
  });
});
