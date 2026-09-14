<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue';

import { CLOUD_PROVIDER_LABELS } from '@chaptale/ipc-contract';

import { AppButton } from '@/components/AppButton';
import { AppDialog } from '@/components/AppDialog';
import { AppScrollArea } from '@/components/AppScrollArea';
import { AppTooltip } from '@/components/AppTooltip';
import { formatSize, formatWhen, useCloudSyncStore } from '@/features/cloud-sync';
import { useEditorStore } from '@/features/editor';
import { useSettingsStore } from '@/features/settings';
import { useWorkbenchStore } from '@/features/workbench';
import { getDesktopApi, toErrorMessage } from '@/utils/desktop-api';

import { useWorkspaceStore } from '../store';
import { describeSyncFile, localSyncSummary } from '../sync-status';

const cloud = useCloudSyncStore();
const settings = useSettingsStore();
const workspace = useWorkspaceStore();
const editor = useEditorStore();
const navigation = useWorkbenchStore();
const busy = ref(false);
const error = ref('');
const disabled = computed(() => busy.value || workspace.isOpening);
const summary = computed(() => localSyncSummary(workspace.rootPath, editor.tabs));
const files = computed(() => editor.tabs.map(tab => ({ tab, status: describeSyncFile(tab) })));
const bindingProvider = computed(() => (cloud.binding ? CLOUD_PROVIDER_LABELS[cloud.binding.provider] : ''));

// 面板打开时才去问云端：状态是给“要不要手动备一次”看的，代价只能是用户主动打开这一下。
watch(
  () => workspace.syncOpen,
  open => {
    if (open) void cloud.refreshCloud();
  }
);

/** 账户、绑定与归档明细都在设置里；这里只给状态与手动备份，不重复一套管理界面。 */
function openCloudSettings() {
  workspace.syncOpen = false;
  settings.openPanel('cloudSync');
}

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
  return run(() => editor.refreshDocuments());
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
        </section>
        <section aria-labelledby="sync-cloud-title">
          <div class="sync-section-heading">
            <h3 id="sync-cloud-title">云端备份</h3>
            <AppButton
              variant="ghost"
              size="sm"
              type="button"
              :disabled="disabled || cloud.isBackupLoading"
              @click="cloud.refreshCloud()"
            >
              <span class="i-mingcute-refresh-3-line size-4" aria-hidden="true" />刷新云端
            </AppButton>
          </div>

          <p v-if="cloud.bindingError" class="has-error" role="alert">{{ cloud.bindingError }}</p>
          <div v-else-if="cloud.binding" class="sync-location">
            <div class="sync-location-copy">
              <strong>{{ cloud.binding.folderName }}</strong>
              <span class="sync-muted">
                {{ bindingProvider }} · 云端归档 {{ cloud.archives.length }} 份 ·
                {{ cloud.lastBackupAt ? `本机上次备份 ${formatWhen(cloud.lastBackupAt)}` : '本机还没备份过' }}
              </span>
              <span class="sync-muted">
                {{
                  cloud.quota
                    ? `云端占用 ${formatSize(cloud.quota.usedBytes)} / ${formatSize(cloud.quota.totalBytes)}`
                    : '云端配额：服务商未提供'
                }}
              </span>
              <span v-if="cloud.isBackupRunning" class="sync-muted" role="status">{{ cloud.progressLabel }}</span>
            </div>
            <div class="sync-folder-actions">
              <AppButton :disabled="disabled || cloud.isBackupRunning" @click="cloud.createBackup()">
                <span class="i-mingcute-cloud-line size-4" aria-hidden="true" />立即备份
              </AppButton>
              <AppButton variant="ghost" :disabled="disabled" @click="openCloudSettings()">云端详情</AppButton>
            </div>
          </div>
          <div v-else class="sync-location">
            <div class="sync-location-copy">
              <span class="sync-muted">还没有绑定云端备份位置，无法手动备份。</span>
            </div>
            <AppButton variant="ghost" :disabled="disabled" @click="openCloudSettings()"
              >去「设置 › 云端备份」</AppButton
            >
          </div>
          <p v-if="cloud.backupError" class="has-error" role="alert">{{ cloud.backupError }}</p>
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
        <p v-if="error" class="has-error" role="alert">{{ error }}</p>
      </AppScrollArea>
      <footer class="sync-footer">
        <span class="sync-muted">这里只反映本机已打开文件的状态；云端备份见设置里的「云端备份」。</span>
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
