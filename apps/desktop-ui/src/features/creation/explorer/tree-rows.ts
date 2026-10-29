import { isImageFile, type Entry, type PendingChange } from '@chaptale/creation/contracts';

/** 行上的待审标记：新建候选、Agent 提出的删除、正式条目有待接受修改，按此优先级只显示一种。 */
export type RowMark = 'new' | 'deleting' | 'modified' | null;

export interface TreeRow {
  entry: Entry;
  depth: number;
  /** 新建的待接受条目对应的修改；打开时进入审阅标签。 */
  pending: PendingChange | null;
  mark: RowMark;
}

const markLabels = { new: '新建，待接受', deleting: '待接受删除', modified: '有待接受修改' } as const;

/** 新建的待接受条目按候选位置显示在正式目录中；只展开 expandedIds 中的目录。 */
export function buildRows(input: {
  entries: readonly Entry[];
  pendingChanges: readonly PendingChange[];
  /** 有待接受修改的正式条目，含待接受删除。 */
  modifiedIds: ReadonlySet<string>;
  section: Entry['section'];
  expandedIds: readonly string[];
}): TreeRow[] {
  const deleting = new Set(input.pendingChanges.filter(change => change.deleted).map(change => change.entryId));
  const items = [
    ...input.entries.filter(entry => entry.section === input.section).map(entry => ({ entry, pending: null })),
    ...input.pendingChanges
      .filter(change => change.base === null && change.candidate.section === input.section)
      .map(change => ({ entry: change.candidate as Entry, pending: change }))
  ];
  const rows: TreeRow[] = [];
  function visit(parentId: string | null, depth: number) {
    for (const { entry, pending } of items
      .filter(item => item.entry.parentId === parentId)
      .toSorted((a, b) => a.entry.position - b.entry.position)) {
      const mark = pending
        ? 'new'
        : deleting.has(entry.id)
          ? 'deleting'
          : input.modifiedIds.has(entry.id)
            ? 'modified'
            : null;
      rows.push({ entry, depth, pending, mark });
      if (entry.kind === 'directory' && input.expandedIds.includes(entry.id)) visit(entry.id, depth + 1);
    }
  }
  visit(null, 1);
  return rows;
}

export function rowLabel(row: TreeRow): string {
  return row.mark ? `${row.entry.title}（${markLabels[row.mark]}）` : row.entry.title;
}

export function entryIcon(entry: Entry, expanded: boolean): string {
  if (entry.kind === 'document') return 'i-mingcute-file-line';
  if (entry.kind === 'file') return isImageFile(entry) ? 'i-mingcute-pic-line' : 'i-mingcute-attachment-line';
  return expanded ? 'i-mingcute-down-line' : 'i-mingcute-right-line';
}

export function fileType(entry: Entry): string {
  if (isImageFile(entry)) return '图片';
  const dot = entry.fileName!.lastIndexOf('.');
  return dot > 0 ? entry.fileName!.slice(dot + 1).toUpperCase() : '文件';
}
