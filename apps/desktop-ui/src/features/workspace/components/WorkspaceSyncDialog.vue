<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import type { OneDriveFolder } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTooltip } from '@/components/AppTooltip';
import { useEditorStore } from '@/features/editor';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useWorkspaceStore } from '../store';
import { describeSyncFile, localSyncSummary } from '../sync-status';

const workspace = useWorkspaceStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const busy = ref(false);
const error = ref('');
const disabled = computed(() => busy.value || workspace.isOpening || workspace.syncLoading);
const summary = computed(() => localSyncSummary(workspace.rootPath, editor.tabs));
const files = computed(() => editor.tabs.map(tab => ({ tab, status: describeSyncFile(tab) })));
const folderNames: Record<OneDriveFolder['kind'], string> = {
  personal: 'OneDrive 个人',
  business: 'OneDrive 工作或学校',
  default: 'OneDrive'
};

watch(
  () => workspace.revision,
  () => void workspace.refreshSyncState(),
  { immediate: true }
);

async function run(action: () => Promise<unknown>) {
  if (disabled.value) return;
  busy.value = true;
  error.value = '';
  try {
    await action();
  } catch (cause) {
    error.value = toErrorMessage(cause);
  } finally {
    busy.value = false;
  }
}
function refresh() {
  return run(() => Promise.all([workspace.refreshSyncState(), editor.refreshDocuments()]));
}
function saveAll() {
  return run(async () => {
    if (!(await editor.saveAll())) error.value = '仍有文件未保存，请检查下方状态。';
  });
}
async function showFile(id: string, conflict = false) {
  navigation.center = 'editor';
  editor.selectTab(id);
  workspace.syncOpen = false;
  await nextTick();
  if (conflict) editor.conflictId = id;
}
function openWorkspace(folder?: string) {
  return run(async () => {
    if (await workspace.openWorkspace(folder)) workspace.syncOpen = false;
    else if (workspace.error) error.value = workspace.error;
  });
}
function revealWorkspace() {
  const rootPath = workspace.rootPath;
  if (rootPath) return run(() => getDesktopApi().workspace.revealEntry({ rootPath, relativePath: '' }));
}
function revealFolder(rootPath: string) {
  return run(() => getDesktopApi().workspace.revealSyncRoot({ rootPath }));
}
</script>
<template>
  <AppDialog :open="workspace.syncOpen" title="文件与同步" content-size="lg" @update:open="workspace.syncOpen = $event">
    <div class="sync-dialog">
      <div class="sync-toolbar">
        <span class="sync-summary" :class="{ 'has-error': summary.error }" role="status">
          <span class="i-mingcute-cloud-line size-5" aria-hidden="true" />{{ summary.label }}
        </span>
        <AppButton :disabled="disabled || !editor.hasUnsaved" @click="saveAll">
          <span class="i-mingcute-save-line size-4" aria-hidden="true" />全部保存
        </AppButton>
        <AppTooltip text="刷新本机状态">
          <AppButton icon variant="ghost" aria-label="刷新本机状态" :disabled="disabled" @click="refresh">
            <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />
          </AppButton>
        </AppTooltip>
      </div>
      <AppScrollArea class="sync-scroll">
        <section aria-labelledby="sync-workspace-title">
          <h3 id="sync-workspace-title">当前作品</h3>
          <div v-if="workspace.rootPath" class="sync-location">
            <div class="sync-location-copy">
              <strong>{{ workspace.displayName }}</strong>
              <span class="sync-path">{{ workspace.rootPath }}</span>
              <span class="sync-muted">{{
                workspace.syncState?.oneDriveRoot ? '位于 OneDrive 本机目录' : '本地目录'
              }}</span>
            </div>
            <AppTooltip text="在文件管理器中打开">
              <AppButton
                icon
                variant="ghost"
                aria-label="打开作品所在目录"
                :disabled="disabled"
                @click="revealWorkspace"
              >
                <span class="i-mingcute-folder-open-2-line size-4" aria-hidden="true" />
              </AppButton>
            </AppTooltip>
          </div>
          <p v-else class="sync-muted">未打开作品</p>
          <p v-if="workspace.syncState?.workspaceError" class="has-error" role="alert">
            {{ workspace.syncState.workspaceError }}
          </p>
        </section>
        <section aria-labelledby="sync-onedrive-title">
          <div class="sync-section-heading">
            <h3 id="sync-onedrive-title">OneDrive</h3>
            <span class="sync-muted">云端状态未知</span>
          </div>
          <p class="sync-muted">本地保存不代表上传完成。客户端运行状态、远端进度和冲突副本未获确认。</p>
          <p v-if="workspace.syncLoading && !workspace.syncState" role="status">正在检查本机目录</p>
          <p v-else-if="workspace.syncState && !workspace.syncState.folders.length" role="status">
            未检测到 OneDrive 本机目录
          </p>
          <div v-for="folder in workspace.syncState?.folders" :key="folder.path" class="sync-folder">
            <div class="sync-location">
              <div class="sync-location-copy">
                <strong>{{ folderNames[folder.kind] }}</strong>
                <span class="sync-path">{{ folder.path }}</span>
              </div>
              <AppTooltip text="打开 OneDrive 目录">
                <AppButton
                  icon
                  variant="ghost"
                  :aria-label="`打开 ${folderNames[folder.kind]} 目录`"
                  :disabled="disabled || !folder.available"
                  @click="revealFolder(folder.path)"
                >
                  <span class="i-mingcute-folder-open-2-line size-4" aria-hidden="true" />
                </AppButton>
              </AppTooltip>
            </div>
            <p v-if="folder.error" class="has-error" role="status">{{ folder.error }}</p>
            <div class="sync-folder-actions">
              <AppButton :disabled="disabled || !folder.available" @click="openWorkspace(folder.path)"
                >打开作品</AppButton
              >
              <AppButton :disabled="disabled || !folder.available" @click="workspace.createWorkspaceAt(folder.path)"
                ><span class="i-mingcute-add-line size-4" aria-hidden="true" />在此新建作品</AppButton
              >
            </div>
          </div>
        </section>
        <section v-if="files.length" aria-labelledby="sync-files-title">
          <h3 id="sync-files-title">已打开的文件 · {{ files.length }}</h3>
          <ul class="sync-files">
            <li v-for="{ tab, status } in files" :key="tab.id" class="sync-file">
              <div class="sync-file-main">
                <AppButton
                  variant="ghost"
                  class="sync-file-name"
                  :aria-label="`定位 ${tab.path}`"
                  @click="showFile(tab.id)"
                >
                  <span class="i-mingcute-file-line size-4 shrink-0" aria-hidden="true" />{{ tab.path }}
                </AppButton>
                <span class="sync-file-status" :class="{ 'has-error': status.issue }">{{ status.label }}</span>
                <AppButton v-if="tab.external" :disabled="disabled || tab.saving" @click="showFile(tab.id, true)"
                  >处理冲突</AppButton
                >
                <AppTooltip v-else-if="tab.dirty" text="保存文件">
                  <AppButton
                    icon
                    variant="ghost"
                    :aria-label="`保存 ${tab.path}`"
                    :disabled="disabled || tab.saving"
                    @click="run(() => editor.saveDocument(tab.id))"
                    ><span class="i-mingcute-save-line size-4" aria-hidden="true"
                  /></AppButton>
                </AppTooltip>
              </div>
              <p v-if="status.detail" class="has-error">{{ status.detail }}</p>
            </li>
          </ul>
        </section>
        <p v-if="error || workspace.syncError" class="has-error" role="alert">{{ error || workspace.syncError }}</p>
      </AppScrollArea>
      <footer class="sync-footer">
        <span class="sync-muted">{{
          workspace.syncState ? `本机检查 ${new Date(workspace.syncState.checkedAt).toLocaleTimeString()}` : ''
        }}</span>
        <AppButton :disabled="disabled" @click="openWorkspace()">打开其他作品</AppButton>
      </footer>
    </div>
  </AppDialog>
</template>
<style scoped lang="scss">
.sync-dialog {
  @apply flex min-h-0 flex-col gap-3 pt-3;
  height: min(620px, calc(100vh - 150px));
  font-size: var(--ui-font-size);
}
.sync-toolbar,
.sync-section-heading,
.sync-location,
.sync-file-main,
.sync-footer {
  @apply flex min-w-0 items-center gap-2;
}
.sync-summary {
  @apply mr-auto flex min-w-0 items-center gap-2 font-medium;
}
.sync-scroll {
  @apply min-h-0 flex-1;
}
section {
  @apply grid min-w-0 gap-3 border-b py-4;
  border-color: var(--border-subtle);
}
section:first-child {
  @apply pt-0;
}
section:last-of-type {
  @apply border-b-0;
}
h3,
strong {
  @apply m-0 font-medium;
  font-size: var(--ui-font-size);
}
p {
  @apply m-0;
  overflow-wrap: anywhere;
}
.sync-location-copy {
  @apply flex min-w-0 flex-1 flex-col gap-1.5;
}
.sync-path,
.sync-file-name {
  overflow-wrap: anywhere;
  white-space: normal;
}
.sync-muted,
.sync-path,
.sync-file-status {
  color: var(--muted-foreground);
  font-size: var(--ui-caption-size);
}
.sync-section-heading,
.sync-footer {
  @apply justify-between;
}
.sync-folder {
  @apply grid min-w-0 gap-3 border-t pt-3;
  border-color: var(--border-subtle);
}
.sync-folder-actions {
  @apply flex flex-wrap justify-end gap-2;
}
.sync-files {
  @apply m-0 grid list-none gap-2 p-0;
}
.sync-file {
  @apply min-w-0 border-b pb-2;
  border-color: var(--border-subtle);
}
.sync-file-name {
  @apply h-auto min-h-8 min-w-0 flex-1 justify-start px-1 text-left;
}
.sync-file-status {
  @apply shrink-0;
}
.sync-file p {
  @apply px-1 pt-1;
}
.has-error {
  color: var(--destructive);
}
.sync-footer {
  @apply shrink-0 border-t pt-3;
  border-color: var(--border-subtle);
}
@media (max-width: 640px) {
  .sync-file-main {
    @apply flex-wrap;
  }
  .sync-file-name {
    flex-basis: 100%;
  }
}
</style>
