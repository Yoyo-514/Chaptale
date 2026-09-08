import { resolveAssetLink, type AssetRecord } from '@chaptale/shared';

import { relations } from './presentation';

export const fieldText = (value: unknown) => (typeof value === 'string' ? value : '');
export const fieldLinks = (value: unknown) =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
export const isPublicAsset = (asset: AssetRecord) =>
  !asset.sourcePath.split('/').some(part => part.startsWith('.')) && asset.role !== 'templates';
export const matchesAsset = (asset: AssetRecord, query: string) => {
  const needle = query.trim().toLocaleLowerCase();
  return (
    !needle ||
    [asset.title, asset.sourcePath, ...asset.aliases, fieldText(asset.frontmatter.summary)].some(value =>
      value.toLocaleLowerCase().includes(needle)
    )
  );
};
export function storyEvents(assets: readonly AssetRecord[], query = '', strand = '', includeArchived = false) {
  return assets
    .filter(
      asset =>
        isPublicAsset(asset) &&
        asset.kind === 'timeline-event' &&
        (includeArchived || asset.status !== 'archived') &&
        matchesAsset(asset, query) &&
        (!strand || fieldText(asset.frontmatter.strand) === strand)
    )
    .toSorted((a, b) => {
      const x = eventOrder(a),
        y = eventOrder(b);
      if (x !== y) return x - y;
      return a.sourcePath.localeCompare(b.sourcePath, 'zh-CN', { numeric: true });
    });
}
export function eventOrder(asset: AssetRecord) {
  const value = asset.frontmatter.order;
  return typeof value === 'number' && Number.isFinite(value) ? value : Infinity;
}
export function characterGraph(assets: readonly AssetRecord[], query = '', includeArchived = false) {
  const characters = assets.filter(
    asset => isPublicAsset(asset) && asset.kind === 'character' && (includeArchived || asset.status !== 'archived')
  );
  const byPath = new Map(characters.map(asset => [asset.sourcePath, asset]));
  const connections = characters.flatMap(source =>
    relations(source).map(relation => {
      const link = relation.link ?? resolveAssetLink(relation.to, assets);
      return Object.assign(relation, {
        source,
        target: link.targetPath ? byPath.get(link.targetPath) : undefined,
        link
      });
    })
  );
  const visible = new Set(characters.filter(asset => matchesAsset(asset, query)).map(asset => asset.sourcePath));
  if (query.trim()) {
    const matches = new Set(visible);
    for (const connection of connections) {
      if (
        connection.target &&
        (matches.has(connection.source.sourcePath) || matches.has(connection.target.sourcePath))
      ) {
        visible.add(connection.source.sourcePath);
        visible.add(connection.target.sourcePath);
      }
    }
  }
  return {
    characters: characters.filter(asset => visible.has(asset.sourcePath)),
    connections: connections.filter(
      connection =>
        visible.has(connection.source.sourcePath) && (!connection.target || visible.has(connection.target.sourcePath))
    )
  };
}
export type CharacterConnection = ReturnType<typeof characterGraph>['connections'][number];
export type CanvasLayout = {
  version: 1;
  positions: Record<string, { x: number; y: number }>;
  viewport?: { x: number; y: number; zoom: number };
};
const coordinate = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= 1_000_000;
export function readCanvasLayout(raw: string | null): CanvasLayout {
  const fallback: CanvasLayout = { version: 1, positions: {} };
  if (!raw || raw.length > 2_000_000) return fallback;
  try {
    const data = JSON.parse(raw);
    if (data?.version !== 1 || !data.positions || typeof data.positions !== 'object' || Array.isArray(data.positions))
      return fallback;
    fallback.positions = Object.fromEntries(
      Object.entries(data.positions)
        .slice(0, 10000)
        .filter(
          ([, position]) =>
            position &&
            typeof position === 'object' &&
            'x' in position &&
            'y' in position &&
            coordinate(position.x) &&
            coordinate(position.y)
        )
    ) as CanvasLayout['positions'];
    const viewport = data.viewport;
    if (
      viewport &&
      coordinate(viewport.x) &&
      coordinate(viewport.y) &&
      typeof viewport.zoom === 'number' &&
      viewport.zoom >= 0.15 &&
      viewport.zoom <= 3
    )
      fallback.viewport = { x: viewport.x, y: viewport.y, zoom: viewport.zoom };
    return fallback;
  } catch {
    return fallback;
  }
}
export function characterLayoutKey(asset: AssetRecord, assets: readonly AssetRecord[]) {
  return asset.id && assets.filter(other => other.id === asset.id).length === 1 ? asset.id : asset.sourcePath;
}
