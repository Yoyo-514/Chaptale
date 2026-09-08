import { describe, expect, it } from 'vitest';

import type { AssetRecord, AssetTemplate } from '@chaptale/shared';
import { parseDocumentFrontmatter } from '@chaptale/shared/document-frontmatter';

import { patchRelationship, patchStoryEvent } from '../story-files';
import { characterGraph, characterLayoutKey, readCanvasLayout, storyEvents } from '../story-model';

const asset = (name: string, fields: Partial<AssetRecord> = {}): AssetRecord => ({
  sourcePath: `${name}.md`,
  title: name,
  kind: 'character',
  role: 'characters',
  aliases: [],
  frontmatter: {},
  contentHash: 'a'.repeat(64),
  sizeBytes: 10,
  chars: 10,
  updatedAt: '',
  excerpt: '',
  links: [],
  backlinks: [],
  ...fields
});
const eventTemplate: AssetTemplate = {
  template: 'story-event',
  name: '故事事件',
  targetKind: 'timeline-event',
  targetRole: 'world',
  body: '',
  source: 'builtin',
  sourcePath: 'builtin',
  hash: 'b'.repeat(64),
  fields: [
    { key: 'title', label: '事件名称', type: 'text', required: true },
    { key: 'order', label: '故事顺序', type: 'number' },
    { key: 'when', label: '故事时间', type: 'text' }
  ]
};
describe('故事资产投影', () => {
  it('只按故事顺序排列，虚构时间不解析，未排序事件放在最后', () => {
    const events = [
      asset('早写的晚事件', {
        kind: 'timeline-event',
        updatedAt: '2000-01-01',
        frontmatter: { order: 2, when: '大劫之后' }
      }),
      asset('晚写的早事件', {
        kind: 'timeline-event',
        updatedAt: '2030-01-01',
        frontmatter: { order: -0.5, when: '清河历八年' }
      }),
      asset('待定', { kind: 'timeline-event' }),
      asset('字符串顺序', { kind: 'timeline-event', frontmatter: { order: '1' } }),
      asset('旧事件', { kind: 'timeline-event', status: 'archived', frontmatter: { order: -10 } }),
      asset('普通角色')
    ];
    expect(storyEvents(events).map(value => value.title)).toEqual([
      '晚写的早事件',
      '早写的晚事件',
      '待定',
      '字符串顺序'
    ]);
    expect(storyEvents(events)[0]?.frontmatter.when).toBe('清河历八年');
    expect(storyEvents(events, '', '', true)[0]?.title).toBe('旧事件');
    expect(storyEvents([])).toEqual([]);
  });
  it('筛选故事线、标题和摘要，不混入内部记录与模板', () => {
    const events = [
      asset('夜航', { kind: 'timeline-event', frontmatter: { strand: '归途', summary: '乘舟过江' } }),
      asset('信件', { kind: 'timeline-event', frontmatter: { strand: '城中' } }),
      asset('.chaptale/夜航', { kind: 'timeline-event' }),
      asset('模板', { kind: 'timeline-event', role: 'templates' })
    ];
    expect(storyEvents(events, '乘舟', '归途').map(value => value.title)).toEqual(['夜航']);
    expect(storyEvents(events, '', '归途')).toHaveLength(1);
    expect(storyEvents(events)).toHaveLength(2);
  });
  it('关系保留原数组索引、歧义和断链，不编造目标', () => {
    const source = asset('甲', {
      frontmatter: {
        relations: [null, { to: '[[乙]]', type: '同窗' }, { to: '[[missing]]' }, { to: '[[id-丙]]', type: '师父' }]
      }
    });
    const assets = [
      source,
      asset('乙', { sourcePath: '角色/乙.md' }),
      asset('另一个乙', { sourcePath: '旁支/乙.md', title: '乙' }),
      asset('丙', { id: 'id-丙' })
    ];
    const graph = characterGraph(assets);
    expect(graph.connections.map(value => value.index)).toEqual([1, 2, 3]);
    expect(graph.connections[0]).toMatchObject({ link: { status: 'ambiguous' }, target: undefined });
    expect(graph.connections[1]).toMatchObject({ link: { status: 'missing' }, target: undefined });
    expect(graph.connections[2]?.target?.title).toBe('丙');
    expect(characterGraph(assets, '甲').characters.map(value => value.title)).toEqual(['甲', '丙']);
  });
  it('布局使用唯一 id，重复 id 回落路径，坏坐标与坏版本不会污染画布', () => {
    const first = asset('甲', { id: 'same' });
    expect(characterLayoutKey(first, [first])).toBe('same');
    expect(characterLayoutKey(first, [first, asset('乙', { id: 'same' })])).toBe('甲.md');
    expect(readCanvasLayout('broken')).toEqual({ version: 1, positions: {} });
    expect(readCanvasLayout(JSON.stringify({ version: 2, positions: { a: { x: 0, y: 0 } } }))).toEqual({
      version: 1,
      positions: {}
    });
    expect(
      readCanvasLayout(
        JSON.stringify({
          version: 1,
          positions: { good: { x: -30, y: 55 }, huge: { x: 2e8, y: 0 }, wrong: { x: '1', y: 1 } },
          viewport: { x: 1, y: 2, zoom: -2 }
        })
      )
    ).toEqual({ version: 1, positions: { good: { x: -30, y: 55 } } });
    expect(
      readCanvasLayout(JSON.stringify({ version: 1, positions: {}, viewport: { x: 1, y: 2, zoom: 0.8 } })).viewport
    ).toEqual({ x: 1, y: 2, zoom: 0.8 });
    expect(readCanvasLayout(' '.repeat(2_000_001))).toEqual({ version: 1, positions: {} });
  });
});
describe('故事文件写入', () => {
  const source =
    '\uFEFF---\r\nkind: character\r\ncustom: 0xFF # 保留\r\nrelations:\r\n  - null\r\n  - { to: "[[乙]]", type: 同窗, private: 作者备注 }\r\n---\r\n原文不改。\r\n';
  it('按原索引修改关系，保留其他项、未知关系字段和正文', () => {
    const content = patchRelationship(source, 1, { to: '[[丙]]', type: '师父', note: '暂不公开' });
    expect(parseDocumentFrontmatter(content)).toMatchObject({
      status: 'ok',
      frontmatter: { relations: [null, { to: '[[丙]]', type: '师父', private: '作者备注', note: '暂不公开' }] },
      body: '原文不改。\r\n'
    });
    expect(content).toContain('custom: 0xFF # 保留\r\n');
    expect(content.startsWith('\uFEFF')).toBe(true);
    expect(parseDocumentFrontmatter(patchRelationship(content, 1, null))).toMatchObject({
      frontmatter: { relations: [null] }
    });
    expect(
      parseDocumentFrontmatter(patchRelationship(source, null, { to: '[[丁]]', type: '邻居', note: '' }))
    ).toMatchObject({ frontmatter: { relations: [null, { private: '作者备注' }, { to: '[[丁]]' }] } });
  });
  it('拒绝非法或过期索引、非角色文件、坏元数据与空关系', () => {
    expect(() => patchRelationship(source, 9, null)).toThrow('已变化');
    expect(() => patchRelationship(source, -1, null)).toThrow('已变化');
    expect(() => patchRelationship(source, null, null)).toThrow('请选择');
    expect(() => patchRelationship('正文', null, { to: '[[乙]]', type: '同窗', note: '' })).toThrow('有效角色');
    expect(() =>
      patchRelationship('---\nkind: character\nrelations: broken\n---\n', null, {
        to: '[[乙]]',
        type: '同窗',
        note: ''
      })
    ).toThrow('不是列表');
    expect(() => patchRelationship(source, null, { to: '[[乙]]', type: ' ', note: '' })).toThrow('不能为空');
  });
  it('事件编辑保留未知字段，允许小数序号并拒绝非法字段与类型', () => {
    const content = '---\nkind: timeline-event\ncustom: retained # 注释\ntitle: 夜航\n---\n正文细节\n';
    const edited = patchStoryEvent(content, { title: '夜航归来', when: '清河历八年冬', order: 1.5 }, eventTemplate);
    expect(edited).toContain('custom: retained # 注释');
    expect(parseDocumentFrontmatter(edited)).toMatchObject({
      frontmatter: { title: '夜航归来', when: '清河历八年冬', order: 1.5 },
      body: '正文细节\n'
    });
    expect(() => patchStoryEvent(content, { title: ' ' }, eventTemplate)).toThrow('不能为空');
    expect(() => patchStoryEvent(content, { title: '夜航', order: '一' }, eventTemplate)).toThrow('类型');
    expect(() => patchStoryEvent(content, { title: '夜航', kind: 'character' }, eventTemplate)).toThrow('未声明');
    expect(() => patchStoryEvent(source, { title: '夜航' }, eventTemplate)).toThrow('类型已变化');
  });
});
