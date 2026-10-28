<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { Entry, PendingChange } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppAlertDialog, AppDialog } from '@/components/AppDialog';
import { AppDropdownMenu, AppDropdownMenuItem } from '@/components/AppDropdownMenu';
import { AppForm, AppFormActions } from '@/components/AppForm';
import { AppInput } from '@/components/AppInput';
import { AppSelect, AppSelectItem } from '@/components/AppSelect';
import { useEditorStore, useReviewStore } from '@/features/editor';
import { toErrorMessage } from '@/utils/desktop-api';

import { requestCreation, useCreationStore } from './store';
import { useTrashStore } from './trash';
import TrashPanel from './TrashPanel.vue';

const creation = useCreationStore();
const editor = useEditorStore();
const review = useReviewStore();
const trash = useTrashStore();
// 确认框先关闭再派发 confirm，删除目标与打开状态分开保存。
const removing = ref<{ entry: Entry; entryCount: number; pendingCount: number } | null>(null);
const removeOpen = ref(false);
/** Agent 提出删除、等待作者接受的条目。 */
const deletingIds = computed(
  () => new Set(creation.pendingChanges.filter(change => change.deleted).map(change => change.entryId))
);
const host = ref<HTMLElement>();
const error = ref('');
const target = ref<Entry>();
const action = ref<'rename' | 'move' | null>(null);
const title = ref('');
const parent = ref('root');
const busy = ref(false);
const tree = computed(() => creation.view![creation.view!.section]);
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
/** 新建的待接受条目按候选位置显示在正式目录中，标记为待接受，打开的是审阅标签。 */
const rows = computed(() => {
  const result: { entry: Entry; depth: number; pending: PendingChange | null }[] = [];
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
const directories = computed(() =>
  creation.entries.filter(
    item => item.kind === 'directory' && item.section === creation.view?.section && item.id !== target.value?.id
  )
);
const menu = computed<AppContextMenuItem[]>(() => [
  {
    id: 'new-document',
    label: creation.view?.section === 'resource' ? '新建资料' : '新建文稿',
    disabled: target.value?.kind === 'document'
  },
  { id: 'new-directory', label: '新建目录', disabled: target.value?.kind === 'document' },
  ...(target.value
    ? [
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
  else await editor.openDocument(entry.id);
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
  const entry = target.value!;
  if (id === 'delete') {
    await requestRemove(entry);
    return;
  }
  if (id === 'rename' && entry.kind === 'document') {
    await editor.openDocument(entry.id);
    const tab = editor.tabs.find(item => item.id === entry.id)!;
    if (tab.status !== 'ready') {
      error.value = tab.status === 'loading' ? '文档正在加载，请稍后重试' : tab.error;
      return;
    }
    title.value = tab.title;
    action.value = 'rename';
    return;
  }
  if (id === 'rename' || id === 'move') {
    title.value = entry.title;
    parent.value = entry.parentId ?? 'root';
    action.value = id;
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
async function submit() {
  busy.value = true;
  error.value = '';
  try {
    const entry = target.value!;
    if (action.value === 'rename' && entry.kind === 'document') {
      editor.updateMetadata(entry.id, { title: title.value });
      action.value = null;
      return;
    }
    if (action.value === 'rename')
      await requestCreation('renameDirectory', {
        commandId: crypto.randomUUID(),
        workId: creation.workId!,
        directoryId: entry.id,
        expectedRevisionId: entry.revisionId,
        title: title.value
      });
    else await creation.move(entry, parent.value === 'root' ? null : parent.value, null);
    await creation.refreshEntries();
    action.value = null;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
/** 删除前读取影响范围，确认框写明一并拒绝的待审修改。 */
async function requestRemove(entry: Entry) {
  error.value = '';
  try {
    removing.value = { entry, ...(await trash.impact([entry.id])) };
    removeOpen.value = true;
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
async function remove() {
  const { entry } = removing.value!;
  error.value = '';
  try {
    // 先关闭其中已打开的文档，未保存的输入由作者在关闭时处理。
    const ids = new Set([entry.id]);
    for (let size = 0; size !== ids.size;) {
      size = ids.size;
      for (const item of creation.entries) if (item.parentId !== null && ids.has(item.parentId)) ids.add(item.id);
    }
    for (const tab of editor.tabs.filter(item => ids.has(item.id))) await editor.closeTab(tab.id);
    if (editor.tabs.some(item => ids.has(item.id))) return;
    await trash.trash([entry.id]);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
function keydown(event: KeyboardEvent, entry: Entry) {
  const index = rows.value.findIndex(row => row.entry.id === entry.id);
  const pending = rows.value[index]?.pending ?? null;
  if (event.key === 'Delete' && !pending) {
    event.preventDefault();
    void requestRemove(entry);
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
async function drop(event: DragEvent, parentId: string | null) {
  const id = event.dataTransfer!.getData('application/chaptale-entry');
  const entry = creation.entries.find(item => item.id === id);
  if (!entry) return;
  try {
    await creation.move(entry, parentId, null);
  } catch (cause) {
    error.value = toErrorMessage(cause);
  }
}
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
    <p v-if="error && !action" class="tree-error" role="alert">{{ error }}</p>
    <AppContextMenu :items="menu" @prepare="target = undefined" @select="selectAction">
      <div
        ref="host"
        class="tree-scroll"
        role="tree"
        :aria-label="creation.view?.section === 'resource' ? '资料目录' : '文稿目录'"
        :tabindex="rows.length ? -1 : 0"
        @scroll="tree.scrollTop = host!.scrollTop"
        @dragover.prevent
        @drop.self.prevent="drop($event, null)"
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
            :style="{ paddingLeft: `${8 + (depth - 1) * 16}px` }"
            class="tree-entry"
            :class="{ selected: tree.selectedId === entry.id, pending: pending }"
            :draggable="!pending"
            @dragstart="!pending && $event.dataTransfer!.setData('application/chaptale-entry', entry.id)"
            @dragover.prevent
            @drop.stop.prevent="!pending && drop($event, entry.kind === 'directory' ? entry.id : entry.parentId)"
            @click="open(entry, pending)"
            @keydown="keydown($event, entry)"
          >
            <span
              class="entry-icon"
              :class="
                entry.kind === 'document'
                  ? 'i-mingcute-file-line'
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
              >
            </div>
          </div>
        </AppContextMenu>
        <p v-if="!rows.length" class="tree-empty">
          {{
            creation.view?.section === 'resource' ? '在这里整理人物、地点与写作笔记。' : '新建文稿，或导入已有正文。'
          }}
        </p>
      </div>
    </AppContextMenu>
    <TrashPanel />
    <AppAlertDialog
      v-model:open="removeOpen"
      :title="`删除“${removing?.entry.title}”？`"
      confirm-label="删除"
      @confirm="remove"
    >
      <template #description
        >{{
          removing && removing.entryCount > 1
            ? `目录及其中 ${removing.entryCount - 1} 项内容会移入作品回收站，可以恢复。`
            : '会移入作品回收站，可以恢复。'
        }}<template v-if="removing?.pendingCount"
          >将一并拒绝 {{ removing.pendingCount }} 处待审修改。</template
        ></template
      >
    </AppAlertDialog>
    <AppDialog
      content-size="sm"
      :open="Boolean(action)"
      :title="action === 'rename' ? (target?.kind === 'document' ? '重命名文档' : '重命名目录') : '移动条目'"
      @update:open="
        value => {
          if (!value && !busy) action = null;
        }
      "
    >
      <AppForm class="tree-form" :disabled="busy" @submit="submit">
        <label v-if="action === 'rename'"
          >{{ target?.kind === 'document' ? '文档标题' : '目录名称'
          }}<AppInput v-model="title" :aria-label="target?.kind === 'document' ? '文档标题' : '目录名称'" autofocus
        /></label>
        <label v-else
          >目标目录<AppSelect v-model="parent" aria-label="目标目录"
            ><AppSelectItem value="root">根目录</AppSelectItem
            ><AppSelectItem v-for="directory in directories" :key="directory.id" :value="directory.id">{{
              directory.title
            }}</AppSelectItem></AppSelect
          ></label
        >
        <p v-if="error" role="alert" class="tree-error">{{ error }}</p>
        <AppFormActions
          ><AppButton :disabled="busy" @click="action = null">取消</AppButton
          ><AppButton type="submit" variant="primary" :disabled="busy || (action === 'rename' && !title.trim())"
            >确认</AppButton
          ></AppFormActions
        >
      </AppForm>
    </AppDialog>
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
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 7px 8px;
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
.tree-form {
  display: grid;
  gap: 12px;
  padding: 12px 0 0;
}
.tree-form label {
  display: grid;
  gap: 6px;
  font-size: 13px;
}
</style>
