import { computed, ref, type Ref } from 'vue';

import type { Entry } from '@chaptale/creation/contracts';

import type { TreeRow } from './tree-rows';

/**
 * 拖放位置。条目拖动显示插入线（before / after / end）或放入目录（into）；
 * 系统文件只按目录区域放下（area），parentId 为 null 表示根目录。
 */
export type DropPlacement =
  | { kind: 'before' | 'after' | 'into'; entryId: string }
  | { kind: 'end' }
  | { kind: 'area'; parentId: string | null };

const entryType = 'application/chaptale-entry';

function hasFiles(event: DragEvent) {
  return event.dataTransfer!.types.includes('Files');
}

export function useTreeDrop(options: {
  rows: Ref<TreeRow[]>;
  entries: () => Entry[];
  host: Ref<HTMLElement | undefined>;
  acceptsFiles: () => boolean;
  move: (entry: Entry, parentId: string | null, beforeEntryId: string | null) => Promise<void>;
  addFiles: (parentId: string | null, files: File[]) => Promise<void>;
}) {
  /** dragover 期间读不到拖动数据，靠它排除拖进自身或子目录。 */
  const dragging = ref<Entry | null>(null);
  const placement = ref<DropPlacement | null>(null);

  /** 系统文件放下的目录连同展开的子条目一起高亮；条目放入目录时只高亮该目录。 */
  const highlighted = computed(() => {
    const ids = new Set<string>();
    const current = placement.value;
    if (current?.kind === 'into') ids.add(current.entryId);
    if (current?.kind !== 'area' || current.parentId === null) return ids;
    const rows = options.rows.value;
    const start = rows.findIndex(row => row.entry.id === current.parentId);
    if (start < 0) return ids;
    ids.add(rows[start]!.entry.id);
    for (const row of rows.slice(start + 1)) {
      if (row.depth <= rows[start]!.depth) break;
      ids.add(row.entry.id);
    }
    return ids;
  });

  function insideDragging(parentId: string | null) {
    for (let id = parentId; id; id = options.entries().find(item => item.id === id)?.parentId ?? null)
      if (id === dragging.value!.id) return true;
    return false;
  }
  function accept(event: DragEvent, next: DropPlacement | null) {
    placement.value = next;
    if (!next) return;
    event.preventDefault();
    event.dataTransfer!.dropEffect = next.kind === 'area' ? 'copy' : 'move';
  }

  function rowDragStart(event: DragEvent, entry: Entry) {
    event.dataTransfer!.setData(entryType, entry.id);
    // 资料树内移动；图片条目拖进正文时复制为插图。
    event.dataTransfer!.effectAllowed = 'copyMove';
    dragging.value = entry;
  }
  function rowDragOver(event: DragEvent, { entry, pending }: TreeRow) {
    if (pending) return accept(event, null);
    if (hasFiles(event)) {
      const parentId = entry.kind === 'directory' ? entry.id : entry.parentId;
      return accept(event, options.acceptsFiles() ? { kind: 'area', parentId } : null);
    }
    if (!dragging.value) return accept(event, null);
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const ratio = (event.clientY - rect.top) / rect.height;
    // 目录中部放入；已展开的目录下半部也放入，避免插入线落在子条目之前却排到整个子树之后。
    const expanded = options.rows.value.some(row => row.entry.parentId === entry.id);
    const kind =
      entry.kind === 'directory' && ratio > 0.25 && (ratio < 0.75 || expanded)
        ? 'into'
        : ratio < 0.5
          ? 'before'
          : 'after';
    const parentId = kind === 'into' ? entry.id : entry.parentId;
    accept(event, insideDragging(parentId) ? null : { kind, entryId: entry.id });
  }
  function listDragOver(event: DragEvent) {
    if (hasFiles(event)) return accept(event, options.acceptsFiles() ? { kind: 'area', parentId: null } : null);
    accept(event, dragging.value ? { kind: 'end' } : null);
  }
  function dragLeave(event: DragEvent) {
    if (!options.host.value!.contains(event.relatedTarget as Node | null)) placement.value = null;
  }
  function dragEnd() {
    dragging.value = null;
    placement.value = null;
  }

  async function drop(event: DragEvent) {
    const current = placement.value;
    dragEnd();
    if (!current) return;
    if (current.kind === 'area') return options.addFiles(current.parentId, [...event.dataTransfer!.files]);
    const entries = options.entries();
    const entry = entries.find(item => item.id === event.dataTransfer!.getData(entryType));
    if (!entry) return;
    if (current.kind === 'end') return options.move(entry, null, null);
    if (current.kind === 'into') return options.move(entry, current.entryId, null);
    if (current.entryId === entry.id) return;
    const target = entries.find(item => item.id === current.entryId)!;
    if (current.kind === 'before') return options.move(entry, target.parentId, target.id);
    const siblings = entries
      .filter(item => item.parentId === target.parentId && item.section === target.section && item.id !== entry.id)
      .toSorted((a, b) => a.position - b.position);
    const next = siblings[siblings.findIndex(item => item.id === target.id) + 1];
    await options.move(entry, target.parentId, next?.id ?? null);
  }

  return { placement, highlighted, rowDragStart, rowDragOver, listDragOver, dragLeave, dragEnd, drop };
}
