<script setup lang="ts">
import { computed, ref } from 'vue';

import type { Entry, TrashBatch } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppAlertDialog } from '@/components/AppDialog';
import { toErrorMessage } from '@/utils/desktop-api';

import { useTrashStore } from './trash';

const trash = useTrashStore();
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
/** 每批按最外层条目逐行列出，恢复与永久删除作用于整批。 */
const rows = computed(() =>
  trash.batches.flatMap(batch => batch.roots.map((entry, index) => ({ batch, entry, first: index === 0 })))
);
const count = computed(() => trash.batches.reduce((sum, batch) => sum + batch.entryCount, 0));
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
function open(batch: TrashBatch, entry: Entry) {
  if (entry.kind === 'document') void trash.show(batch.id, entry);
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
  return target ? `永久删除“${target.roots.map(entry => entry.title).join('”“')}”？` : '';
});
const purgeCount = computed(() => {
  const target = purging.value;
  return target === 'all' ? count.value : (target?.entryCount ?? 0);
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
        v-for="{ batch, entry, first } in rows"
        :key="entry.id"
        :items="menu"
        @select="id => select(id, batch)"
      >
        <div
          class="trash-row"
          :class="{ grouped: !first, current: trash.preview?.document.id === entry.id }"
          :tabindex="entry.kind === 'document' ? 0 : -1"
          :aria-label="`${entry.title}，删除于 ${date.format(batch.deletedAt)}`"
          @click="open(batch, entry)"
          @keydown.enter.prevent="open(batch, entry)"
        >
          <span
            class="trash-entry-icon"
            :class="entry.kind === 'document' ? 'i-mingcute-file-line' : 'i-mingcute-folder-line'"
            aria-hidden="true"
          />
          <span class="trash-text">
            <span class="trash-title" :title="entry.title">{{ entry.title }}</span>
            <span v-if="first" class="trash-meta"
              >{{ entry.section === 'resource' ? '资料' : '文稿' }} ·
              <time :datetime="new Date(batch.deletedAt).toISOString()">{{ date.format(batch.deletedAt) }}</time
              ><template v-if="batch.entryCount > 1"> · 共 {{ batch.entryCount }} 项</template></span
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
      <p v-if="!rows.length" class="trash-empty">回收站是空的。删除的文稿、资料和目录会保留在这里，可以随时恢复。</p>
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
