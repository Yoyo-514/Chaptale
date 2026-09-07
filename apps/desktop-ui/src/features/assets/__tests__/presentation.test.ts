import { describe, expect, it } from 'vitest';

import type { AssetRecord } from '@chaptale/shared';

import { groupAssets, relations } from '../presentation';

const asset = (sourcePath: string, fields: Partial<AssetRecord> = {}): AssetRecord => ({
  sourcePath,
  role: 'characters',
  title: sourcePath.split('/').at(-1)!,
  kind: 'character',
  aliases: [],
  frontmatter: {},
  contentHash: 'a'.repeat(64),
  updatedAt: '',
  sizeBytes: 0,
  chars: 0,
  excerpt: '',
  links: [],
  backlinks: [],
  ...fields
});
describe('资产投影', () => {
  it('目录按实际路径、分组跨目录，筛选名称路径别名', () => {
    const assets = [
      asset('角色/主要/甲.md', { frontmatter: { importance: 'main' }, aliases: ['阿甲'] }),
      asset('自定目录/乙.md', { frontmatter: { importance: 'main' } }),
      asset('角色/旧人.md', { status: 'archived' })
    ];
    expect(groupAssets(assets, 'characters', 'directory').map(group => group.label)).toHaveLength(2);
    expect(groupAssets(assets, 'characters', 'grouped')).toMatchObject([{ label: '主要角色', assets: [{}, {}] }]);
    expect(groupAssets(assets, 'characters', 'grouped', '阿甲')[0]?.assets[0]?.sourcePath).toBe('角色/主要/甲.md');
    expect(groupAssets(assets, 'characters', 'directory', '旧人')).toEqual([]);
    expect(groupAssets(assets, 'characters', 'directory', '旧人', true)).toHaveLength(1);
  });
  it('未分类不丢失，内部观察和模板不混入资产库', () => {
    const assets = [
      asset('随记.md', { kind: undefined, role: 'inspiration' }),
      asset('角色/自由.md', { kind: undefined }),
      asset('.chaptale/memory/notes/观察.md', { kind: undefined, role: 'notes' }),
      asset('模板/角色.md', { role: 'templates' })
    ];
    expect(groupAssets(assets, 'unclassified', 'grouped')[0]?.assets).toHaveLength(2);
    expect(groupAssets(assets, 'characters', 'grouped')[0]?.assets.map(item => item.sourcePath)).toEqual([
      '角色/自由.md'
    ]);
  });
  it('章节按显式章序，关系保留断链和自由标签', () => {
    const assets = [
      asset('正文/十.md', { kind: 'chapter', frontmatter: { order: 10 } }),
      asset('正文/二.md', { kind: 'chapter', frontmatter: { order: 2 } })
    ];
    expect(groupAssets(assets, 'chapters', 'directory')[0]?.assets.map(item => item.frontmatter.order)).toEqual([
      2, 10
    ]);
    const target = asset('角色/甲.md', {
      frontmatter: { relations: [null, { to: '[[乙]]', type: '未公开盟友', note: '双方知情' }, { to: 5 }] },
      links: [{ link: '[[乙]]', status: 'missing', candidates: [] }]
    });
    expect(relations(target)).toEqual([{ to: '[[乙]]', type: '未公开盟友', note: '双方知情', link: target.links[0] }]);
  });
});
