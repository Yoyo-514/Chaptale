import type { AssetRecord, ContentEntry, ContentKind } from '@chaptale/shared';

import { assetKindLabel } from '@/features/assets';

export function contentOptions(kind: ContentKind, entries: readonly ContentEntry[], selected: readonly string[] = []) {
  const available = new Map(
    entries.filter(entry => entry.kind === kind && entry.effective && !entry.archived).map(entry => [entry.id, entry])
  );
  return [...new Set([...available.keys(), ...selected])].toSorted().map(id => {
    const entry = available.get(id);
    return {
      value: id,
      label: entry?.name ?? id,
      detail: !entry ? '不可用' : entry.persona?.enabled === false ? '停用' : id,
      available: Boolean(entry)
    };
  });
}

export function contentKindOptions(
  entries: readonly ContentEntry[],
  assets: readonly AssetRecord[],
  selected: readonly string[] = []
) {
  const kinds = new Set(
    [
      ...entries
        .filter(entry => entry.kind === 'template' && entry.effective && !entry.archived)
        .map(entry => entry.targetKind),
      ...assets.filter(asset => asset.status !== 'archived' && asset.role !== 'templates').map(asset => asset.kind),
      ...selected
    ].filter((value): value is string => typeof value === 'string' && Boolean(value))
  );
  return [...kinds].toSorted().map(value => ({ value, label: assetKindLabel(value), description: value }));
}
