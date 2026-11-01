<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Entry, StoryRelationRef, TrashBatch } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppAlertDialog } from '@/components/AppDialog';
import { toErrorMessage } from '@/utils/desktop-api';

import { useCreationStore } from '../store';
import { useTrashStore } from './store';

const trash = useTrashStore();
const creation = useCreationStore();
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
type TrashRow = { key: string; title: string; label: string; icon: string; entry: Entry | null };
function relationTitle(relation: StoryRelationRef) {
  const names = relation.resourceIds.map(
    id => creation.entries.find(entry => entry.id === id)?.title ?? '已删除的资料'
  );
  return `${relation.type}：${names.join('、')}`;
}
/** 批次内逐行列出最外层条目、单独删除的事件与关系。 */
function batchRows(batch: TrashBatch): TrashRow[] {
  return [
    ...batch.roots.map(entry => ({
      key: entry.id,
      title: entry.title,
      label: entry.section === 'resource' ? '资料' : '文稿',
      icon: entry.kind === 'document' ? 'i-mingcute-file-line' : 'i-mingcute-folder-line',
      entry
    })),
    ...batch.records.map(record => ({
      key: record.id,
      title: record.text,
      label: '事件',
      icon: 'i-mingcute-time-line',
      entry: null
    })),
    ...batch.relations.map(relation => ({
      key: relation.id,
      title: relationTitle(relation),
      label: '关系',
      icon: 'i-mingcute-link-line',
      entry: null
    }))
  ];
}
/** 恢复与永久删除作用于整批，批次首行显示类别与时间。 */
const rows = computed(() =>
  trash.batches.flatMap(batch =>
    batchRows(batch).map((row, index) => Object.assign(row, { batch, first: index === 0 }))
  )
);
const batchSize = (batch: TrashBatch) => batch.entryCount + batch.records.length + batch.relations.length;
const count = computed(() => trash.batches.reduce((sum, batch) => sum + batchSize(batch), 0));
// 确认框先关闭再派发 confirm，清空目标与打开状态分开保存。
const purging = ref<TrashBatch | 'all' | null>(null);
const purgeOpen = ref(false);
const busy = ref(false);
const menu: AppContextMenuItem[] = [
  { id: 'restore', label: '恢复' },
  { id: 'purge', label: '永久删除', separatorBefore: true }
];

async function run(task: () => Promise<void>) {
  busy.value = true;
  trash.error = '';
  try {
    await task();
  } catch (cause) {
    trash.error = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
function select(id: string, batch: TrashBatch) {
  if (id === 'restore') void run(() => trash.restore(batch.id));
  else askPurge(batch);
}
function open(batch: TrashBatch, entry: Entry | null) {
  if (entry?.kind === 'document') void trash.show(batch.id, entry);
}
function askPurge(target: TrashBatch | 'all') {
  purging.value = target;
  purgeOpen.value = true;
}
function confirmPurge() {
  const target = purging.value;
  if (target) void run(() => trash.purge(target === 'all' ? null : target.id));
}
const purgeTitle = computed(() => {
  const target = purging.value;
  if (target === 'all') return '清空回收站？';
  if (!target) return '';
  const titles = batchRows(target).map(row => row.title);
  return `永久删除“${titles.join('”“')}”？`;
});
const purgeCount = computed(() => {
  const target = purging.value;
  return target === 'all' ? count.value : target ? batchSize(target) : 0;
});
</script>

<template>
  <section class="trash-panel" :class="{ open: trash.open }" aria-label="回收站">
    <div class="trash-heading">
      <button
        class="trash-toggle"
        type="button"
        :aria-expanded="trash.open"
        aria-controls="trash-list"
        @click="trash.open = !trash.open"
      >
        <span
          class="trash-chevron"
          :class="trash.open ? 'i-mingcute-down-line' : 'i-mingcute-right-line'"
          aria-hidden="true"
        />
        <span class="i-mingcute-delete-2-line trash-icon" aria-hidden="true" />
        <span>回收站</span>
        <span v-if="count" class="trash-count">{{ count }}</span>
      </button>
      <AppButton v-if="trash.open && count" size="xs" variant="ghost" :disabled="busy" @click="askPurge('all')"
        >清空</AppButton
      >
    </div>
    <div v-if="trash.open" id="trash-list" class="trash-list">
      <p v-if="trash.error" class="trash-error" role="alert">{{ trash.error }}</p>
      <AppContextMenu
        v-for="{ batch, entry, key, title, label, icon, first } in rows"
        :key="key"
        :items="menu"
        @select="id => select(id, batch)"
      >
        <div
          class="trash-row"
          :class="{ grouped: !first, current: trash.preview?.document.id === key }"
          :tabindex="entry?.kind === 'document' ? 0 : -1"
          :aria-label="`${title}，删除于 ${date.format(batch.deletedAt)}`"
          @click="open(batch, entry)"
          @keydown.enter.prevent="open(batch, entry)"
        >
          <span class="trash-entry-icon" :class="icon" aria-hidden="true" />
          <span class="trash-text">
            <span class="trash-title" :title="title">{{ title }}</span>
            <span v-if="first" class="trash-meta"
              >{{ label }} ·
              <time :datetime="new Date(batch.deletedAt).toISOString()">{{ date.format(batch.deletedAt) }}</time
              ><template v-if="batchSize(batch) > 1"> · 共 {{ batchSize(batch) }} 项</template></span
            >
          </span>
          <span v-if="first" class="trash-actions">
            <AppButton
              icon
              size="xs"
              variant="ghost"
              :disabled="busy"
              aria-label="恢复"
              title="恢复"
              @click.stop="run(() => trash.restore(batch.id))"
              ><span class="i-mingcute-back-2-line size-3.5" aria-hidden="true"
            /></AppButton>
            <AppButton
              icon
              size="xs"
              variant="ghost"
              :disabled="busy"
              aria-label="永久删除"
              title="永久删除"
              @click.stop="askPurge(batch)"
              ><span class="i-mingcute-close-line size-3.5" aria-hidden="true"
            /></AppButton>
          </span>
        </div>
      </AppContextMenu>
      <p v-if="!rows.length" class="trash-empty">
        回收站是空的。删除的文稿、资料、目录、事件和关系会保留在这里，可以随时恢复。
      </p>
    </div>
    <AppAlertDialog v-model:open="purgeOpen" :title="purgeTitle" confirm-label="永久删除" @confirm="confirmPurge">
      <template #description
        >将删除 {{ purgeCount }} 项内容及其历史版本，无法恢复。会话中对它们的引用会显示为“已删除”。</template
      >
    </AppAlertDialog>
  </section>
</template>

<style scoped>
.trash-panel {
  display: flex;
  flex-direction: column;
  flex-shrink: 0;
  min-height: 0;
  border-top: 1px solid var(--border-subtle);
}
.trash-panel.open {
  max-height: 45%;
}
.trash-heading {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 32px;
  padding-right: 8px;
}
.trash-toggle {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 6px;
  min-width: 0;
  height: 32px;
  padding: 0 8px;
  border: 0;
  background: transparent;
  color: var(--muted-foreground);
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
.trash-toggle:hover {
  color: var(--foreground);
}
.trash-toggle:focus-visible,
.trash-row:focus-visible {
  outline: 2px solid var(--ring);
  outline-offset: -2px;
}
.trash-chevron,
.trash-icon,
.trash-entry-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}
.trash-count {
  margin-left: auto;
  font-variant-numeric: tabular-nums;
}
.trash-list {
  flex: 1;
  min-height: 0;
  overflow: auto;
  padding-bottom: 4px;
}
.trash-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px 6px 28px;
  color: var(--muted-foreground);
  cursor: default;
}
.trash-row[tabindex='0'] {
  cursor: pointer;
}
.trash-row.grouped {
  padding-top: 0;
}
.trash-row:hover {
  background: var(--surface-hover);
}
.trash-row.current {
  background: var(--accent);
  color: var(--accent-foreground);
}
.trash-entry-icon {
  margin-top: 2px;
}
.trash-text {
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 2px;
  min-width: 0;
}
.trash-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}
.trash-meta {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 12px;
  font-variant-numeric: tabular-nums;
}
.trash-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
}
.trash-row:hover .trash-actions,
.trash-row:focus-within .trash-actions {
  opacity: 1;
}
.trash-empty,
.trash-error {
  margin: 0;
  padding: 6px 12px 10px 28px;
  font-size: 12px;
  line-height: 1.5;
  color: var(--muted-foreground);
}
.trash-error {
  color: var(--destructive);
}
</style>
