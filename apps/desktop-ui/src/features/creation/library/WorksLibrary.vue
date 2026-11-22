<script setup lang="ts">
import { ref } from 'vue';

import type { TrashedWork, Work } from '@chaptale/creation/contracts';

import { AppButton } from '@/components/AppButton';
import { AppContextMenu, type AppContextMenuItem } from '@/components/AppContextMenu';
import { AppAlertDialog } from '@/components/AppDialog';
import { CloudRestoreDialog, useCloudSyncStore } from '@/features/cloud-sync';
import { toErrorMessage } from '@/utils/desktop-api';

import { useCreationStore } from '../store';
import { useWorkPackageStore } from './work-package';
import { useWorkTrashStore } from './work-trash';

const creation = useCreationStore();
const trash = useWorkTrashStore();
const packages = useWorkPackageStore();
const cloud = useCloudSyncStore();
const date = new Intl.DateTimeFormat('zh-CN', { dateStyle: 'medium', timeStyle: 'short' });
function workMenu(work: Work): AppContextMenuItem[] {
  return [
    { id: 'export', label: '导出作品包' },
    cloud.backupMenu,
    ...(packages.snapshots.some(item => item.workId === work.id) ? [{ id: 'restore', label: '恢复导入前的版本' }] : []),
    { id: 'delete', label: '删除作品', separatorBefore: true }
  ];
}
// 确认框先关闭再派发 confirm，目标与开关分开保存。
const restoring = ref<Work | null>(null);
const restoreOpen = ref(false);
const actionError = ref('');
// 确认框先关闭再派发 confirm，目标与开关分开保存。
const removing = ref<{ work: Work; pendingCount: number } | null>(null);
const removeOpen = ref(false);
const purging = ref<TrashedWork | null>(null);
const purgeOpen = ref(false);

async function run(action: () => Promise<unknown>) {
  actionError.value = '';
  try {
    await action();
  } catch (cause) {
    actionError.value = toErrorMessage(cause);
  }
}
function selectWorkAction(id: string, work: Work) {
  if (cloud.selectBackup(id, work)) return;
  if (id === 'delete') askRemove(work);
  else if (id === 'export') void packages.exportFromLibrary(work);
  else {
    restoring.value = work;
    restoreOpen.value = true;
  }
}
function askRemove(work: Work) {
  void run(async () => {
    removing.value = { work, pendingCount: (await trash.impact(work.id)).pendingCount };
    removeOpen.value = true;
  });
}
function remove() {
  const target = removing.value;
  if (target) void run(() => creation.trashWork(target.work.id));
}
function askPurge(work: TrashedWork) {
  purging.value = work;
  purgeOpen.value = true;
}
function purge() {
  const target = purging.value;
  if (target) void run(() => trash.purge(target.id));
}
</script>

<template>
  <main class="works-library" aria-label="作品库">
    <header class="library-header">
      <h1>作品库</h1>
      <div class="library-actions">
        <AppButton variant="ghost" :aria-pressed="trash.open" @click="trash.open = !trash.open">{{
          trash.open ? '返回作品库' : `回收站${trash.works.length ? `（${trash.works.length}）` : ''}`
        }}</AppButton>
        <AppButton variant="ghost" :disabled="!creation.connected" @click="packages.chooseImport()"
          >导入作品包</AppButton
        >
        <AppButton variant="ghost" :disabled="!creation.connected" @click="cloud.openRestore()">从云端恢复</AppButton>
        <AppButton variant="primary" :disabled="!creation.connected" @click="creation.newWorkOpen = true"
          >新建作品</AppButton
        >
      </div>
    </header>
    <div v-if="creation.error" class="library-error" role="alert">
      {{ creation.error }}
      <AppButton size="xs" :disabled="creation.busy" @click="creation.connect()">重新连接</AppButton>
    </div>
    <p v-if="actionError || trash.error || packages.error || creation.workError" class="library-error" role="alert">
      {{ actionError || trash.error || packages.error || creation.workError }}
    </p>
    <section v-if="trash.open" class="library-list" aria-label="作品库回收站">
      <p v-if="!trash.works.length" class="library-empty">回收站是空的。</p>
      <table v-else>
        <thead>
          <tr>
            <th scope="col">作品名称</th>
            <th scope="col">删除时间</th>
            <th scope="col"><span class="sr-only">操作</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="work in trash.works" :key="work.id" class="trashed-row">
            <td>
              <span class="work-title trashed-title">
                <span class="i-mingcute-book-2-line" aria-hidden="true" />{{ work.title }}
              </span>
            </td>
            <td>
              <time :datetime="new Date(work.deletedAt).toISOString()">{{ date.format(work.deletedAt) }}</time>
            </td>
            <td class="trashed-actions">
              <AppButton size="xs" variant="ghost" @click="run(() => trash.restore(work.id))">恢复</AppButton>
              <AppButton size="xs" variant="ghost" @click="askPurge(work)">永久删除</AppButton>
            </td>
          </tr>
        </tbody>
      </table>
    </section>
    <p v-else-if="creation.busy && !creation.works.length" class="library-empty" role="status">正在读取作品库…</p>
    <div v-else-if="!creation.works.length && creation.connected" class="library-empty">
      <h2>从一部作品开始</h2>
      <p>新建作品，开始整理文稿与资料。</p>
    </div>
    <div v-else class="library-list">
      <table>
        <thead>
          <tr>
            <th scope="col">作品名称</th>
            <th scope="col">类型</th>
            <th scope="col">最近编辑</th>
          </tr>
        </thead>
        <tbody>
          <AppContextMenu
            v-for="work in creation.works"
            :key="work.id"
            :items="workMenu(work)"
            @select="id => selectWorkAction(id, work)"
          >
            <tr
              :aria-disabled="creation.busy"
              @click="!creation.busy && creation.openWork(work.id)"
              @keydown="event => event.key === 'Delete' && askRemove(work)"
            >
              <td>
                <button class="work-title" :disabled="creation.busy">
                  <span class="i-mingcute-book-2-line" aria-hidden="true" />{{ work.title }}
                </button>
              </td>
              <td>{{ work.kind === 'novel' ? '小说' : '剧本' }}</td>
              <td>
                <time :datetime="new Date(work.updatedAt).toISOString()">{{ date.format(work.updatedAt) }}</time>
              </td>
            </tr>
          </AppContextMenu>
        </tbody>
      </table>
    </div>
    <CloudRestoreDialog @restore="packages.chooseImport($event)" />
    <AppAlertDialog
      v-model:open="restoreOpen"
      :title="`恢复《${restoring?.title}》导入前的版本？`"
      description="作品会换回最近一次覆盖导入之前的内容，当前内容移入系统回收站，这部作品的待接受修改会被拒绝。"
      confirm-label="恢复"
      @confirm="restoring && packages.restoreSnapshot(restoring.id)"
    />
    <AppAlertDialog
      v-model:open="packages.conflictOpen"
      :title="`作品库中已有《${packages.conflict?.info.work.title}》`"
      description="另存副本会新建一部作品。覆盖会把这部作品换成作品包里的内容并拒绝它的待接受修改，之后可以在作品库右键菜单恢复导入前的版本。"
      confirm-label="另存为副本"
      @confirm="packages.resolveConflict(true)"
    >
      <div class="import-overwrite">
        <AppButton size="sm" variant="ghost" @click="packages.resolveConflict(false)">覆盖原作品</AppButton>
      </div>
    </AppAlertDialog>
    <AppAlertDialog
      v-model:open="removeOpen"
      :title="`删除《${removing?.work.title}》？`"
      confirm-label="删除"
      @confirm="remove"
    >
      <template #description
        >作品会移入作品库回收站，内容、历史版本和会话归属都保留，可以恢复。<template v-if="removing?.pendingCount"
          >将一并拒绝 {{ removing.pendingCount }} 处待审修改，恢复后不再恢复。</template
        ></template
      >
    </AppAlertDialog>
    <AppAlertDialog
      v-model:open="purgeOpen"
      :title="`永久删除《${purging?.title}》？`"
      confirm-label="永久删除"
      @confirm="purge"
    >
      <template #description
        >作品目录（含正文、资料与添加的文件）会移入系统回收站，并从作品库移除。属于它的会话保留，转为未归属作品的会话。</template
      >
    </AppAlertDialog>
  </main>
</template>

<style scoped>
.works-library {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  overflow: hidden;
  background: var(--background);
}
.library-header {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 16px;
  padding: 24px 32px 20px;
  border-bottom: 1px solid var(--border-subtle);
}
h1 {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
}
.library-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-left: auto;
}
.library-list {
  overflow: auto;
  padding: 8px 32px 32px;
}
table {
  width: 100%;
  border-collapse: collapse;
  font-size: var(--ui-font-size);
  text-align: left;
}
th {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
  font-weight: 500;
  padding: 12px 8px;
}
td {
  padding: 4px 8px;
  border-top: 1px solid var(--border-subtle);
}
td:first-child {
  width: 60%;
}
td:last-child {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
  color: var(--muted-foreground);
}
.work-title {
  display: flex;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 14px 0;
  background: none;
  border: 0;
  color: var(--foreground);
  text-align: left;
  font: inherit;
  cursor: pointer;
  overflow-wrap: anywhere;
}
.work-title span {
  flex-shrink: 0;
  width: 18px;
  height: 18px;
  color: var(--muted-foreground);
}
tbody tr {
  cursor: pointer;
}
tbody tr:hover,
tbody tr:focus-within {
  background: var(--accent);
}
tbody tr[aria-disabled='true'] {
  cursor: wait;
}
.trashed-title {
  cursor: default;
}
.trashed-row {
  cursor: default;
}
.trashed-actions {
  text-align: right;
}
.library-empty {
  margin: 64px auto;
  padding: 0 24px;
  max-width: 65ch;
  color: var(--muted-foreground);
}
.library-empty h2 {
  color: var(--foreground);
  font-size: 16px;
  font-weight: 500;
}
.import-overwrite {
  display: flex;
  justify-content: flex-end;
}
.library-error {
  padding: 12px 32px;
  color: var(--destructive);
}
@media (max-width: 900px) {
  .library-header {
    padding: 16px;
  }
  .library-list {
    padding: 8px 16px;
  }
}
</style>
