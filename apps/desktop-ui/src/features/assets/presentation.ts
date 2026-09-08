import type { AssetRecord } from '@chaptale/shared';

export const assetViews = [
  { id: 'chapters', label: '章节', kind: 'chapter', role: 'manuscript', template: 'chapter' },
  { id: 'outline', label: '大纲', kind: 'outline', role: 'outline', template: 'outline-rough' },
  { id: 'characters', label: '角色', kind: 'character', role: 'characters', template: 'character-main' },
  { id: 'world', label: '设定', kind: 'world', role: 'world', template: 'worldview' },
  { id: 'threads', label: '伏笔', kind: 'plot-thread', role: 'threads', template: 'plot-thread' },
  { id: 'timeline', label: '时间线', kind: 'timeline-event', role: 'world', template: 'story-event' },
  { id: 'unclassified', label: '未分类', kind: '', role: '', template: 'character-main' }
] as const;
export type AssetViewId = (typeof assetViews)[number]['id'];
export type AssetGroup = { label: string; assets: AssetRecord[] };
const knownKinds = new Set(['chapter', 'outline', 'scene-card', 'character', 'world', 'plot-thread', 'timeline-event']);
const names: Record<string, string> = {
  main: '主要角色',
  secondary: '次要角色',
  minor: '配角',
  extra: '其他角色',
  rough: '粗纲',
  detailed: '细纲',
  'scene-card': '场景卡',
  draft: '草稿',
  revised: '已修订',
  final: '已定稿',
  planted: '已埋设',
  advanced: '推进中',
  revealed: '已揭示',
  resolved: '已回收',
  abandoned: '已放弃',
  archived: '已归档'
};
export const isUnclassified = (asset: AssetRecord) => !knownKinds.has(asset.kind ?? '');
const kindLabels: Record<string, string> = {
  chapter: '章节',
  outline: '大纲',
  'scene-card': '场景卡',
  character: '角色',
  world: '设定',
  'plot-thread': '伏笔',
  'timeline-event': '故事事件',
  note: '笔记'
};
export const assetKindLabel = (kind?: string) => (kind ? (kindLabels[kind] ?? kind) : '未分类');
export function groupAssets(
  assets: readonly AssetRecord[],
  view: AssetViewId,
  mode: 'directory' | 'grouped',
  query = '',
  includeArchived = false
): AssetGroup[] {
  const definition = assetViews.find(item => item.id === view)!;
  const search = query.trim().toLocaleLowerCase();
  const groups = new Map<string, AssetRecord[]>();
  for (const asset of assets) {
    if (
      asset.sourcePath.startsWith('.') ||
      asset.role === 'templates' ||
      (!includeArchived && asset.status === 'archived')
    )
      continue;
    const matches =
      view === 'unclassified'
        ? isUnclassified(asset)
        : asset.kind === definition.kind ||
          (view === 'outline' && asset.kind === 'scene-card') ||
          (isUnclassified(asset) && asset.role === definition.role);
    if (
      !matches ||
      (search &&
        ![asset.title, asset.sourcePath, ...asset.aliases].some(value => value.toLocaleLowerCase().includes(search)))
    )
      continue;
    let label = asset.sourcePath.split('/').slice(0, -1).join('/') || '作品根目录';
    if (mode === 'grouped') {
      const value =
        view === 'characters'
          ? asset.frontmatter.importance
          : view === 'world'
            ? asset.frontmatter.category
            : view === 'outline'
              ? asset.kind === 'scene-card'
                ? 'scene-card'
                : asset.frontmatter.level
              : asset.status;
      label = isUnclassified(asset)
        ? '未分类'
        : typeof value === 'string' && value
          ? (names[value] ?? value)
          : '未分组';
    }
    const group = groups.get(label) ?? [];
    group.push(asset);
    groups.set(label, group);
  }
  return [...groups]
    .toSorted(([a], [b]) => a.localeCompare(b, 'zh-CN', { numeric: true }))
    .map(([label, items]) => ({
      label,
      assets: items.toSorted((a, b) => {
        const orderA = a.frontmatter.order,
          orderB = b.frontmatter.order;
        if (view === 'chapters' && typeof orderA === 'number' && typeof orderB === 'number' && orderA !== orderB)
          return orderA - orderB;
        return a.sourcePath.localeCompare(b.sourcePath, 'zh-CN', { numeric: true });
      })
    }));
}
export function relations(asset: AssetRecord) {
  const values = asset.frontmatter.relations;
  if (!Array.isArray(values)) return [];
  return values.flatMap((value: unknown, index) => {
    if (!value || typeof value !== 'object' || !('to' in value) || typeof value.to !== 'string') return [];
    return [
      {
        index,
        to: value.to,
        type: 'type' in value && typeof value.type === 'string' ? value.type : '关联',
        note: 'note' in value && typeof value.note === 'string' ? value.note : '',
        link: asset.links.find(link => link.link === value.to)
      }
    ];
  });
}
