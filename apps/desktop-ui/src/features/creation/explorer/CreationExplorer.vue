<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { isImageFile, type Entry, type PendingChange } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { useEditorStore, useHistoryStore, useReviewStore } from '@/features/editor';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import FilePreview from '../files/FilePreview.vue';
import { canChooseOpener, runFileAction } from '../files/files';
import { useCreationStore } from '../store';
import TrashPanel from '../trash/TrashPanel.vue';
import EntryDialogs from './EntryDialogs.vue';
import { useTreeDrop, type TreeRow } from './tree-drop';

const creation = useCreationStore();
const editor = useEditorStore();
const review = useReviewStore();
const history = useHistoryStore();
const dialogs = ref<InstanceType<typeof EntryDialogs>>();
/** Agent 提出删除、等待作者接受的条目。 */
const deletingIds = computed(
  () => new Set(creation.pendingChanges.filter(change => change.deleted).map(change => change.entryId))
);
const host = ref<HTMLElement>();
const error = ref('');
const target = ref<Entry>();
const preview = ref<Entry | null>(null);
const tree = computed(() => creation.view![creation.view!.section]);
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
/** 新建的待接受条目按候选位置显示在正式目录中，标记为待接受，打开的是审阅标签。 */
const rows = computed(() => {
  const result: TreeRow[] = [];
  const section = creation.view?.section;
  const items = [
    ...creation.entries.filter(item => item.section === section).map(entry => ({ entry, pending: null })),
    ...creation.pendingChanges
      .filter(change => change.base === null && change.candidate.section === section)
      .map(change => ({ entry: change.candidate as Entry, pending: change }))
  ];
  function visit(parentId: string | null, depth: number) {
    for (const { entry, pending } of items
      .filter(item => item.entry.parentId === parentId)
      .toSorted((a, b) => a.entry.position - b.entry.position)) {
      result.push({ entry, depth, pending });
      if (entry.kind === 'directory' && tree.value.expandedIds.includes(entry.id)) visit(entry.id, depth + 1);
    }
  }
  visit(null, 1);
  return result;
});
const fileMenu = computed<AppContextMenuItem[]>(() => [
  { id: 'open', label: '打开' },
  ...(target.value && isImageFile(target.value) ? [{ id: 'open-external', label: '用外部程序打开' }] : []),
  ...(canChooseOpener ? [{ id: 'open-with', label: '打开方式…' }] : []),
  { id: 'show-in-folder', label: '在文件夹中显示' }
]);
const menu = computed<AppContextMenuItem[]>(() => [
  ...(target.value?.kind === 'file'
    ? fileMenu.value
    : [
        {
          id: 'new-document',
          label: creation.view?.section === 'resource' ? '新建资料' : '新建文稿',
          disabled: target.value?.kind === 'document'
        },
        { id: 'new-directory', label: '新建目录', disabled: target.value?.kind === 'document' },
        ...(creation.view?.section === 'resource'
          ? [{ id: 'add-files', label: '添加文件…', disabled: target.value?.kind === 'document' }]
          : [])
      ]),
  ...(target.value
    ? [
        ...(target.value.kind === 'document' ? [{ id: 'history', label: '查看历史', separatorBefore: true }] : []),
        { id: 'rename', label: '重命名', separatorBefore: true },
        { id: 'move', label: '移动到…' },
        { id: 'up', label: '上移' },
        { id: 'down', label: '下移' },
        { id: 'delete', label: '删除', separatorBefore: true }
      ]
    : [
        { id: 'import', label: '导入文稿与资料…', separatorBefore: true },
        { id: 'export', label: '导出正文…' }
      ])
]);
function toggle(entry: Entry) {
  const ids = tree.value.expandedIds;
  tree.value.expandedIds = ids.includes(entry.id) ? ids.filter(id => id !== entry.id) : [...ids, entry.id];
}
const pendingMenu: AppContextMenuItem[] = [
  { id: 'review', label: '查看修改' },
  { id: 'accept', label: '接受', separatorBefore: true },
  { id: 'reject', label: '拒绝' }
];
function showReview(change: PendingChange) {
  void review.reveal({
    id: change.id,
    sessionId: change.sessionId,
    workId: change.workId,
    entryId: change.entryId,
    title: change.candidate.title
  });
}
async function selectPendingAction(id: string, change: PendingChange) {
  error.value = '';
  if (id === 'review') {
    showReview(change);
    return;
  }
  try {
    await review.decideChange(change.id, id as 'accept' | 'reject');
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
async function open(entry: Entry, pending: PendingChange | null = null) {
  tree.value.selectedId = entry.id;
  if (entry.kind === 'directory') toggle(entry);
  else if (pending) showReview(pending);
  else if (entry.kind === 'file') await openFile(entry, 'open');
  else await editor.openDocument(entry.id);
}
/** 图片在应用内预览，其他文件交给系统程序。 */
async function openFile(entry: Entry, action: 'open' | 'open-with' | 'show-in-folder', external = false) {
  if (action === 'open' && !external && isImageFile(entry)) {
    preview.value = entry;
    return;
  }
  try {
    await runFileAction(creation.workId!, entry, action);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
async function pickFiles(parentId: string | null) {
  const paths = await getDesktopApi().creation.selectPaths('add-files');
  if (paths) await addFiles(parentId, paths);
}
function fileType(entry: Entry) {
  if (isImageFile(entry)) return '图片';
  const dot = entry.fileName!.lastIndexOf('.');
  return dot > 0 ? entry.fileName!.slice(dot + 1).toUpperCase() : '文件';
}
async function addFiles(parentId: string | null, paths: string[]) {
  try {
    await creation.addFiles(parentId, paths);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
async function selectAction(id: string) {
  error.value = '';
  if (id.startsWith('new-')) {
    creation.newEntry = { kind: id === 'new-directory' ? 'directory' : 'document', parentId: target.value?.id ?? null };
    return;
  }
  if (id === 'import') {
    creation.importOpen = true;
    return;
  }
  if (id === 'export') {
    creation.exportOpen = true;
    return;
  }
  if (id === 'add-files') {
    await pickFiles(target.value?.id ?? null);
    return;
  }
  const entry = target.value!;
  if (id === 'open-external') {
    await openFile(entry, 'open', true);
    return;
  }
  if (id === 'open' || id === 'open-with' || id === 'show-in-folder') {
    await openFile(entry, id);
    return;
  }
  if (id === 'history') {
    history.open(entry.id);
    return;
  }
  if (id === 'delete' || id === 'rename' || id === 'move') {
    await dialogs.value![id === 'delete' ? 'remove' : id](entry);
    return;
  }
  const siblings = creation.entries
    .filter(item => item.parentId === entry.parentId && item.section === entry.section)
    .toSorted((a, b) => a.position - b.position);
  const index = siblings.findIndex(item => item.id === entry.id);
  if ((id === 'up' && index === 0) || (id === 'down' && index === siblings.length - 1)) return;
  try {
    await creation.move(
      entry,
      entry.parentId,
      id === 'up' ? siblings[index - 1]!.id : (siblings[index + 2]?.id ?? null)
    );
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
function keydown(event: KeyboardEvent, entry: Entry) {
  const index = rows.value.findIndex(row => row.entry.id === entry.id);
  const pending = rows.value[index]?.pending ?? null;
  if (event.key === 'Delete' && !pending) {
    event.preventDefault();
    error.value = '';
    void dialogs.value!.remove(entry);
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = rows.value[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) {
      tree.value.selectedId = next.entry.id;
      void nextTick(() => host.value?.querySelector<HTMLElement>(`[data-entry-id="${next.entry.id}"]`)?.focus());
    }
  } else if (event.key === 'ArrowRight' && entry.kind === 'directory') {
    event.preventDefault();
    if (!tree.value.expandedIds.includes(entry.id)) toggle(entry);
  } else if (event.key === 'ArrowLeft') {
    event.preventDefault();
    if (tree.value.expandedIds.includes(entry.id)) toggle(entry);
    else if (entry.parentId) {
      tree.value.selectedId = entry.parentId;
      host.value?.querySelector<HTMLElement>(`[data-entry-id="${entry.parentId}"]`)?.focus();
    }
  } else if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    void open(entry, pending);
  }
}
watch(
  () => [creation.workId, creation.view?.section],
  async () => {
    await nextTick();
    if (host.value) host.value.scrollTop = tree.value.scrollTop;
  }
);
function dropLine(entry: Entry, kind: 'before' | 'after') {
  const current = treeDrop.placement.value;
  return current?.kind === kind && current.entryId === entry.id;
}
const treeDrop = useTreeDrop({
  rows,
  entries: () => creation.entries,
  host,
  acceptsFiles: () => creation.view!.section === 'resource',
  move: async (entry, parentId, beforeEntryId) => {
    error.value = '';
    try {
      await creation.move(entry, parentId, beforeEntryId);
    } catch (cause) {
      error.value = toErrorMessage(cause);
    }
  },
  addFiles: (parentId, files) =>
    addFiles(
      parentId,
      files.map(file => getDesktopApi().creation.pathForFile(file))
    )
});
</script>

<template>
  <aside class="creation-explorer" aria-label="作品导航">
    <div class="work-heading">
      <span class="work-name" :title="creation.work?.title">{{ creation.work?.title }}</span>
      <AppDropdownMenu align="end" content-size="sm">
        <template #trigger>
          <AppButton icon size="xs" variant="ghost" aria-label="作品操作" title="作品操作">
            <span class="i-mingcute-more-1-line work-menu-icon" aria-hidden="true" />
          </AppButton>
        </template>
        <AppDropdownMenuItem density="sm" @select="creation.newEntry = { kind: 'document', parentId: null }">
          {{ creation.view?.section === 'resource' ? '新建资料' : '新建文稿' }}
        </AppDropdownMenuItem>
        <AppDropdownMenuItem density="sm" @select="creation.newEntry = { kind: 'directory', parentId: null }"
          >新建目录</AppDropdownMenuItem
        >
        <AppDropdownMenuItem v-if="creation.view?.section === 'resource'" density="sm" @select="pickFiles(null)"
          >添加文件…</AppDropdownMenuItem
        >
        <AppDropdownMenuItem density="sm" @select="creation.importOpen = true">导入文稿与资料…</AppDropdownMenuItem>
        <AppDropdownMenuItem density="sm" @select="creation.exportOpen = true">导出正文…</AppDropdownMenuItem>
      </AppDropdownMenu>
    </div>
    <div class="section-tabs" role="tablist" aria-label="内容区域">
      <button
        role="tab"
        :aria-selected="creation.view?.section === 'manuscript'"
        @click="creation.view!.section = 'manuscript'"
      >
        文稿
      </button>
      <button
        role="tab"
        :aria-selected="creation.view?.section === 'resource'"
        @click="creation.view!.section = 'resource'"
      >
        资料
      </button>
    </div>
    <p v-if="error" class="tree-error" role="alert">{{ error }}</p>
    <AppContextMenu :items="menu" @prepare="target = undefined" @select="selectAction">
      <div
        ref="host"
        class="tree-scroll"
        role="tree"
        :aria-label="creation.view?.section === 'resource' ? '资料目录' : '文稿目录'"
        :tabindex="rows.length ? -1 : 0"
        :class="{
          'drop-root': treeDrop.placement.value?.kind === 'area' && treeDrop.placement.value.parentId === null
        }"
        @scroll="tree.scrollTop = host!.scrollTop"
        @dragover="treeDrop.listDragOver"
        @dragleave="treeDrop.dragLeave"
        @drop.prevent="treeDrop.drop"
      >
        <AppContextMenu
          v-for="({ entry, depth, pending }, index) in rows"
          :key="entry.id"
          :items="pending ? pendingMenu : menu"
          @prepare="target = pending ? undefined : entry"
          @select="id => (pending ? selectPendingAction(id, pending) : selectAction(id))"
        >
          <div
            role="treeitem"
            :data-entry-id="entry.id"
            :aria-level="depth"
            :aria-expanded="entry.kind === 'directory' ? tree.expandedIds.includes(entry.id) : undefined"
            :aria-selected="tree.selectedId === entry.id"
            :tabindex="tree.selectedId === entry.id || (!tree.selectedId && index === 0) ? 0 : -1"
            :aria-label="
              pending
                ? `${entry.title}（新建，待接受）`
                : deletingIds.has(entry.id)
                  ? `${entry.title}（待接受删除）`
                  : creation.pendingEntryIds.has(entry.id)
                    ? `${entry.title}（有待接受修改）`
                    : entry.title
            "
            :style="{ '--indent': `${8 + (depth - 1) * 16}px` }"
            class="tree-entry"
            :class="{
              selected: tree.selectedId === entry.id,
              pending: pending,
              'drop-into': treeDrop.highlighted.value.has(entry.id),
              'drop-before': dropLine(entry, 'before'),
              'drop-after': dropLine(entry, 'after')
            }"
            :draggable="!pending"
            @dragstart="treeDrop.rowDragStart($event, entry)"
            @dragend="treeDrop.dragEnd"
            @dragover.stop="treeDrop.rowDragOver($event, { entry, depth, pending })"
            @drop.stop.prevent="treeDrop.drop"
            @click="open(entry, pending)"
            @keydown="keydown($event, entry)"
          >
            <span
              class="entry-icon"
              :class="
                entry.kind === 'document'
                  ? 'i-mingcute-file-line'
                  : entry.kind === 'file'
                    ? isImageFile(entry)
                      ? 'i-mingcute-pic-line'
                      : 'i-mingcute-attachment-line'
                    : tree.expandedIds.includes(entry.id)
                      ? 'i-mingcute-down-line'
                      : 'i-mingcute-right-line'
              "
              aria-hidden="true"
            />
            <div class="entry-text">
              <span class="entry-title" :title="entry.title"
                >{{ entry.title
                }}<span
                  v-if="creation.pendingEntryIds.has(entry.id)"
                  class="entry-pending"
                  title="有待接受修改"
                  aria-hidden="true" /></span
              ><span v-if="pending" class="entry-meta">待接受</span
              ><span v-else-if="deletingIds.has(entry.id)" class="entry-meta entry-deleting">待接受删除</span
              ><span v-else-if="entry.kind === 'document'" class="entry-meta" :title="date.format(entry.updatedAt)"
                >{{ entry.wordCount }} 字
                <time :datetime="new Date(entry.updatedAt).toISOString()">{{
                  date.format(entry.updatedAt)
                }}</time></span
              ><span v-else-if="entry.kind === 'file'" class="entry-meta"
                >{{ fileType(entry) }}
                <time :datetime="new Date(entry.updatedAt).toISOString()">{{
                  date.format(entry.updatedAt)
                }}</time></span
              >
            </div>
          </div>
        </AppContextMenu>
        <div v-if="treeDrop.placement.value?.kind === 'end'" class="drop-end-line" aria-hidden="true" />
        <p v-if="!rows.length" class="tree-empty">
          {{
            creation.view?.section === 'resource' ? '在这里整理人物、地点与写作笔记。' : '新建文稿，或导入已有正文。'
          }}
        </p>
      </div>
    </AppContextMenu>
    <TrashPanel />
    <EntryDialogs ref="dialogs" @error="message => (error = message)" />
    <FilePreview v-model:entry="preview" :work-id="creation.workId" />
  </aside>
</template>

<style scoped>
.creation-explorer {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  background: var(--sidebar);
}
.work-heading {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 36px;
  padding: 0 8px 0 12px;
  border-bottom: 1px solid var(--border-subtle);
}
.work-name {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
  color: var(--foreground);
}
.work-menu-icon {
  display: block;
  width: 16px;
  height: 16px;
  flex-shrink: 0;
}
.section-tabs {
  display: flex;
  padding: 8px;
  gap: 4px;
}
.section-tabs button {
  flex: 1;
  padding: 6px;
  border: 0;
  border-radius: 4px;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  font-size: 13px;
  cursor: pointer;
}
.section-tabs button[aria-selected='true'] {
  background: var(--accent);
  color: var(--accent-foreground);
}
.section-tabs button:focus-visible,
.tree-entry:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.tree-scroll {
  flex: 1;
  min-height: 0;
  overflow: auto;
}
.tree-entry {
  position: relative;
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px 7px var(--indent);
  cursor: pointer;
  color: var(--foreground);
}
.tree-entry:hover {
  background: var(--surface-hover);
}
.tree-entry.selected {
  background: var(--accent);
  color: var(--accent-foreground);
}
/* 拖放反馈：条目拖动显示插入线或目录着色；系统文件按目录区域着色，放到根目录时整个列表描边。 */
.tree-entry.drop-into {
  background: color-mix(in srgb, var(--primary) 14%, transparent);
}
.tree-entry.drop-before::before,
.tree-entry.drop-after::after,
.drop-end-line {
  content: '';
  position: absolute;
  right: 4px;
  left: var(--indent, 8px);
  height: 2px;
  border-radius: 1px;
  background: var(--primary);
  pointer-events: none;
}
.tree-entry.drop-before::before {
  top: -1px;
}
.tree-entry.drop-after::after {
  bottom: -1px;
}
.drop-end-line {
  position: relative;
  display: block;
  margin-top: -1px;
}
.tree-scroll.drop-root {
  background: color-mix(in srgb, var(--primary) 8%, transparent);
  box-shadow: inset 0 0 0 1px var(--ring);
}
.entry-icon {
  width: 15px;
  height: 15px;
  flex-shrink: 0;
  margin-top: 2px;
}
.entry-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.entry-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.tree-entry.pending .entry-title {
  font-style: italic;
  color: var(--muted-foreground);
}
.entry-deleting {
  color: var(--destructive);
}
.tree-entry.pending .entry-meta {
  color: var(--warning);
}
.entry-pending {
  display: inline-block;
  width: 6px;
  height: 6px;
  margin-left: 6px;
  border-radius: 50%;
  background: var(--warning);
  vertical-align: middle;
}
.entry-meta {
  display: flex;
  gap: 8px;
  overflow: hidden;
  white-space: nowrap;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
  color: var(--muted-foreground);
}
.entry-meta time {
  overflow: hidden;
  text-overflow: ellipsis;
}
.tree-empty {
  padding: 8px 16px;
  font-size: 12px;
  color: var(--muted-foreground);
  line-height: 1.6;
}
.tree-error {
  margin: 0;
  padding: 8px 12px;
  font-size: 12px;
  color: var(--destructive);
}
</style>
